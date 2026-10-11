// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { endSession, useLogin } from '../../api/auth';
import { setUnauthorizedHandler } from '../../api/client';
import { SESSION_CHANNEL, type SessionMessage, startSessionSync } from '../../api/sessionSync';
import type { AuthUser } from '../../api/types';
import { installDomShims } from '../../test/domSetup';
import { AppLayout } from '../layout/AppLayout';
import { RequireAuth, RequireCan } from './guards';

/** EventSource whose events the test fires by hand. */
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

/**
 * BroadcastChannel between "tabs" of one test: like the browser, a message
 * reaches every other open channel of the same name, never the sender, and
 * arrives asynchronously as a structured clone.
 */
class FakeBroadcastChannel {
  static channels: FakeBroadcastChannel[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly posted: unknown[] = [];
  private closed = false;

  constructor(readonly name: string) {
    FakeBroadcastChannel.channels.push(this);
  }
  postMessage(data: unknown) {
    this.posted.push(data);
    for (const other of FakeBroadcastChannel.channels) {
      if (other === this || other.closed || other.name !== this.name) continue;
      const copy = structuredClone(data);
      queueMicrotask(() => other.onmessage?.({ data: copy } as MessageEvent));
    }
  }
  close() {
    this.closed = true;
  }
}

const ADMIN: AuthUser = { id: 'u1', username: 'ayse', role: 'ADMIN' };

/** What the backend currently says about the session; null = 401. */
let serverUser: AuthUser | null;

function mockBackend() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url === '/api/auth/me') {
      return serverUser ? json(200, { user: serverUser }) : json(401, { message: 'Unauthorized' });
    }
    if (url === '/api/auth/login') return json(200, { user: ADMIN });
    if (url === '/api/auth/logout') return new Response(null, { status: 204 });
    return json(404, { message: 'Not Found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** One browser tab: the app's routes, its own QueryClient and session channel. */
function renderTab(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  setUnauthorizedHandler(() => endSession(queryClient));
  const stopSync = startSessionSync(queryClient, (name) => new FakeBroadcastChannel(name) as unknown as BroadcastChannel);
  const router = createMemoryRouter(
    [
      { path: '/login', element: <p>Giriş ekranı</p> },
      {
        element: (
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <p>Panel sayfası</p> },
          {
            path: 'users',
            element: (
              <RequireCan permission="manageUsers">
                <p>Kullanıcılar sayfası</p>
              </RequireCan>
            ),
          },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
  return { router, queryClient, stopSync, channel: FakeBroadcastChannel.channels.at(-1)! };
}

/** Stands for another tab of the same browser. */
function otherTab() {
  return new FakeBroadcastChannel(SESSION_CHANNEL);
}

const stream = () => FakeEventSource.instances.at(-1)!;
const usersLink = () => screen.queryByRole('link', { name: 'Kullanıcılar' });

describe('session lifecycle in the app', () => {
  let stopSync: (() => void) | undefined;

  beforeEach(() => {
    installDomShims();
    FakeEventSource.instances = [];
    FakeBroadcastChannel.channels = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.spyOn(notifications, 'show').mockReturnValue('');
    serverUser = ADMIN;
  });
  afterEach(() => {
    stopSync?.();
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setUnauthorizedHandler(() => {});
  });

  async function openAsAdmin(path: string) {
    mockBackend();
    const tab = renderTab(path);
    stopSync = tab.stopSync;
    await waitFor(() => expect(stream()).toBeDefined());
    act(() => stream().emit('open'));
    return tab;
  }

  describe('live stream session events', () => {
    it('session-changed: an admin demoted to viewer on /users is sent to the dashboard, and the admin menu disappears', async () => {
      const { router } = await openAsAdmin('/users');
      expect(screen.getByText('Kullanıcılar sayfası')).toBeTruthy();
      expect(usersLink()).toBeTruthy();
      expect(screen.getByText('(Yönetici)')).toBeTruthy();

      serverUser = { ...ADMIN, role: 'VIEWER' };
      act(() => stream().emit('session-changed', { changes: ['role'] }));

      await waitFor(() => expect(router.state.location.pathname).toBe('/'));
      expect(screen.getByText('Panel sayfası')).toBeTruthy();
      expect(usersLink()).toBeNull();
      expect(screen.getByText('(İzleyici)')).toBeTruthy();
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Rolünüz Yönetici → İzleyici olarak değiştirildi.' }),
      );
      // Still logged in, stream still open.
      expect(stream().readyState).toBe(FakeEventSource.OPEN);
    });

    it('session-ended: straight to /login with the notice, stream closed, cache empty', async () => {
      const { router, queryClient } = await openAsAdmin('/users');
      const first = stream();

      serverUser = null;
      act(() => first.emit('session-ended', { reason: 'deleted' }));

      await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
      expect(screen.getByText('Giriş ekranı')).toBeTruthy();
      expect(first.readyState).toBe(FakeEventSource.CLOSED);
      expect(FakeEventSource.instances).toHaveLength(1);
      expect(queryClient.getQueryCache().getAll().map((q) => q.queryKey)).toEqual([['me']]);
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Oturumunuz sonlandırıldı',
          message: 'Hesabınız bir yönetici tarafından kaldırıldı.',
        }),
      );
    });
  });

  describe('between tabs (BroadcastChannel)', () => {
    it('a logout in another tab: cache cleared, stream closed, /login', async () => {
      const { router, queryClient } = await openAsAdmin('/users');
      queryClient.setQueryData(['users'], [ADMIN]);
      const live = stream();

      // Nothing else happens in this tab: the message alone must do it.
      serverUser = null;
      otherTab().postMessage({ type: 'logout', userId: ADMIN.id } satisfies SessionMessage);

      await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
      expect(live.readyState).toBe(FakeEventSource.CLOSED);
      expect(queryClient.getQueryData(['users'])).toBeUndefined();
      expect(queryClient.getQueryData(['me'])).toBeNull();
    });

    it("ignores another tab's logout of a different user (this tab has since logged in as someone else)", async () => {
      const { router } = await openAsAdmin('/');
      otherTab().postMessage({ type: 'logout', userId: 'someone-else' } satisfies SessionMessage);
      await act(async () => {});
      expect(router.state.location.pathname).toBe('/');
      expect(stream().readyState).toBe(FakeEventSource.OPEN);
    });

    it('a login in another tab: a tab on /login reloads ["me"] and opens the app', async () => {
      serverUser = null;
      mockBackend();
      const tab = renderTab('/users');
      stopSync = tab.stopSync;
      await waitFor(() => expect(tab.router.state.location.pathname).toBe('/login'));

      serverUser = ADMIN;
      otherTab().postMessage({ type: 'login', userId: ADMIN.id } satisfies SessionMessage);

      // Back where it was before being sent to /login is the login page's job;
      // here the guard simply lets the app through once ['me'] is known.
      await waitFor(() => expect(tab.queryClient.getQueryData(['me'])).toEqual(ADMIN));
    });

    it('the Çıkış button tells the other tabs', async () => {
      const { channel, router } = await openAsAdmin('/');
      const listener = otherTab();
      const received: unknown[] = [];
      listener.onmessage = (event) => received.push(event.data);

      fireEvent.click(screen.getByRole('button', { name: 'Çıkış' }));

      await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
      expect(channel.posted).toEqual([{ type: 'logout', userId: ADMIN.id }]);
      await waitFor(() => expect(received).toEqual([{ type: 'logout', userId: ADMIN.id }]));
    });

    it('a successful login tells the other tabs', async () => {
      mockBackend();
      const queryClient = new QueryClient();
      stopSync = startSessionSync(queryClient, (name) => new FakeBroadcastChannel(name) as unknown as BroadcastChannel);
      const channel = FakeBroadcastChannel.channels.at(-1)!;
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );
      const { result } = renderHook(() => useLogin(), { wrapper });

      await act(() => result.current.mutateAsync({ username: 'ayse', password: 'x' }));

      expect(channel.posted).toEqual([{ type: 'login', userId: ADMIN.id }]);
    });
  });
});
