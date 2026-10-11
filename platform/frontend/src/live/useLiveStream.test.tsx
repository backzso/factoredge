// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { notifications } from '@mantine/notifications';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMe } from '../api/auth';
import { setUnauthorizedHandler } from '../api/client';
import { useLiveStream } from './useLiveStream';

/** Minimal EventSource whose events the test fires by hand. */
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readyState = FakeEventSource.CONNECTING;
  private listeners = new Map<string, Array<(e: MessageEvent<string>) => void>>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (e: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(type: string, data?: unknown) {
    if (type === 'open') this.readyState = FakeEventSource.OPEN;
    const event = { data: JSON.stringify(data ?? {}) } as MessageEvent<string>;
    this.listeners.get(type)?.forEach((l) => l(event));
  }
}

const latest = () => FakeEventSource.instances.at(-1)!;

function mockMe(status: number, role: 'ADMIN' | 'VIEWER' = 'ADMIN') {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(status === 200 ? { user: { id: 'u', username: 'a', role } } : {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderStream(queryClient = new QueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useLiveStream(), { wrapper });
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe('useLiveStream silence watchdog', () => {
  beforeEach(() => {
    // Only timers and the clock: fetch's Response body parsing needs real setImmediate.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setUnauthorizedHandler(() => {});
  });

  it('stays live while heartbeats arrive', async () => {
    mockMe(200);
    const { result } = renderStream();
    act(() => latest().emit('open'));
    act(() => latest().emit('snapshot', { devices: [] }));
    expect(result.current).toBe('live');

    for (let i = 0; i < 12; i++) {
      await advance(5_000);
      act(() => latest().emit('heartbeat', { ts: '' }));
    }
    expect(result.current).toBe('live');
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('closes a silent stream after 15 s, shows reconnecting and reopens with backoff', async () => {
    const fetchMock = mockMe(502);
    const { result } = renderStream();
    act(() => latest().emit('open'));
    act(() => latest().emit('snapshot', { devices: [] }));
    const first = latest();

    // Backend gone behind the proxy: no event, no error.
    await advance(14_999);
    expect(result.current).toBe('live');
    await advance(1);

    expect(result.current).toBe('reconnecting');
    expect(first.readyState).toBe(FakeEventSource.CLOSED);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', expect.anything());

    // 502 is not a lost session: reopen after the first backoff delay.
    await advance(1_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(result.current).toBe('reconnecting');

    // Still nothing: the new stream is watched too, and the delay grows.
    await advance(15_000);
    await advance(1_999);
    expect(FakeEventSource.instances).toHaveLength(2);
    await advance(1);
    expect(FakeEventSource.instances).toHaveLength(3);

    // Backend back.
    act(() => latest().emit('open'));
    expect(result.current).toBe('live');
  });

  it('full chain: connect → silence → watchdog closes → backoff → new EventSource → open → live → snapshot repairs the cache', async () => {
    mockMe(200);
    const queryClient = new QueryClient();
    queryClient.setQueryData(['devices'], [
      {
        id: 'd1',
        name: 'Line 1',
        protocol: 'MQTT',
        enabled: true,
        createdAt: '',
        updatedAt: '',
        config: { brokerUrl: 'mqtt://b', topicPrefix: 'x', staleAfterMs: 3000 },
        health: { status: 'ONLINE', lastSeenAt: null, lastError: null },
      },
    ]);
    const { result } = renderStream(queryClient);

    // 1. connect
    const first = latest();
    expect(first.url).toBe('/api/stream');
    act(() => first.emit('open'));
    expect(result.current).toBe('live');

    // 2. silence (no events, no error) → 3. the watchdog closes it
    await advance(15_000);
    expect(first.readyState).toBe(FakeEventSource.CLOSED);
    expect(result.current).toBe('reconnecting');
    // The browser does not reconnect a stream we closed: nothing new yet.
    expect(FakeEventSource.instances).toHaveLength(1);

    // 4. backoff (first delay 1 s) → 5. a new EventSource
    await advance(999);
    expect(FakeEventSource.instances).toHaveLength(1);
    await advance(1);
    expect(FakeEventSource.instances).toHaveLength(2);
    const second = latest();
    expect(second).not.toBe(first);
    expect(second.url).toBe('/api/stream');

    // 6. open → 7. live
    act(() => second.emit('open'));
    expect(result.current).toBe('live');

    // The snapshot of the new connection replaces the last known health.
    act(() =>
      second.emit('snapshot', {
        devices: [{ deviceId: 'd1', status: 'OFFLINE', lastSeenAt: null, lastError: 'ECONNREFUSED', latest: null }],
      }),
    );
    const devices = queryClient.getQueryData<Array<{ health: { status: string } }>>(['devices']);
    expect(devices?.[0]?.health.status).toBe('OFFLINE');

    // Events on the old, closed stream are ignored.
    act(() => first.emit('error'));
    expect(result.current).toBe('live');
  });

  it('ends the session when the check after silence answers 401', async () => {
    mockMe(401);
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    renderStream();
    act(() => latest().emit('open'));

    await advance(15_000);

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await advance(30_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('a stream that never opens is also given up after 15 s', async () => {
    mockMe(502);
    const { result } = renderStream();
    expect(result.current).toBe('connecting');
    await advance(15_000);
    expect(result.current).toBe('reconnecting');
    expect(latest().readyState).toBe(FakeEventSource.CLOSED);
  });
});

describe('useLiveStream session events', () => {
  const ME = { id: 'u', username: 'a', role: 'ADMIN' as const };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.spyOn(notifications, 'show').mockReturnValue('');
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function loggedIn() {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['me'], ME);
    queryClient.setQueryData(['users'], [ME]);
    queryClient.setQueryData(['devices'], []);
    return queryClient;
  }

  it('session-ended closes the stream for good, clears the cache and shows the notice', async () => {
    const fetchMock = mockMe(200);
    const queryClient = loggedIn();
    renderStream(queryClient);
    const stream = latest();
    act(() => stream.emit('open'));

    act(() => stream.emit('session-ended', { reason: 'deleted' }));

    expect(stream.readyState).toBe(FakeEventSource.CLOSED);
    expect(queryClient.getQueryData(['me'])).toBeNull();
    expect(queryClient.getQueryData(['users'])).toBeUndefined();
    expect(queryClient.getQueryData(['devices'])).toBeUndefined();
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Oturumunuz sonlandırıldı' }),
    );

    // The server then ends the response: no reconnect, no session check, no new stream.
    act(() => stream.emit('error'));
    await advance(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('session-changed reloads ["me"] and keeps the stream open', async () => {
    const fetchMock = mockMe(200, 'VIEWER');
    const queryClient = loggedIn();
    // Like the layout: useMe gives ['me'] its query function.
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => ({ me: useMe().data, live: useLiveStream() }), { wrapper });
    const stream = latest();
    act(() => stream.emit('open'));
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => stream.emit('session-changed', { changes: ['role'] }));
    await act(async () => {
      await vi.waitFor(() => expect(result.current.me?.role).toBe('VIEWER'));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', expect.anything());
    expect(result.current.live).toBe('live');

    expect(stream.readyState).toBe(FakeEventSource.OPEN);
    expect(queryClient.getQueryData(['devices'])).toEqual([]);
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Rolünüz Yönetici → İzleyici olarak değiştirildi.' }),
    );
  });
});
