// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setUnauthorizedHandler } from '../../api/client';
import { flushRealTasks, installDomShims } from '../../test/domSetup';
import { RequireAuth } from './guards';

const UNAVAILABLE = 'Sunucuya ulaşılamadı, yeniden deneniyor';
const USER = { user: { id: 'u1', username: 'admin', role: 'ADMIN' } };

/** /api/auth/me answers with these statuses in order (the last one repeats); "net" = network error. */
function mockMe(...answers: Array<number | 'net'>) {
  let call = 0;
  const fetchMock = vi.fn(async () => {
    const answer = answers[Math.min(call++, answers.length - 1)]!;
    if (answer === 'net') throw new TypeError('Failed to fetch');
    const body = answer === 200 ? USER : { message: answer === 401 ? 'Unauthorized' : 'Bad Gateway' };
    return new Response(JSON.stringify(body), { status: answer, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderApp(path = '/devices') {
  const queryClient = new QueryClient();
  const router = createMemoryRouter(
    [
      { path: '/login', element: <p>Giriş ekranı</p> },
      { path: '/devices', element: <RequireAuth><p>Cihazlar sayfası</p></RequireAuth> },
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
  return { router, queryClient };
}

/** Advances the fake clock, then lets real async work (fetch body parsing) finish. */
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await flushRealTasks();
  });

describe('RequireAuth with an unreachable backend', () => {
  const onUnauthorized = vi.fn();

  beforeEach(() => {
    installDomShims();
    // TanStack Query notifies observers with setTimeout(0), which the fake clock
    // would hold back; notify synchronously instead.
    notifyManager.setScheduler((callback) => callback());
    // Only timers and the clock: fetch's Response body parsing needs real setImmediate.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    onUnauthorized.mockReset();
    setUnauthorizedHandler(onUnauthorized);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setUnauthorizedHandler(() => {});
    notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  });

  it('waits on 502 with growing delays, keeps the session, then opens the requested page', async () => {
    const fetchMock = mockMe(502, 502, 'net', 503, 200);
    const { router, queryClient } = renderApp('/devices');

    await advance(0);
    expect(screen.getByText(UNAVAILABLE)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Retries after 1 s, 2 s, 5 s, then 10 s.
    await advance(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await advance(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // Still waiting, never sent to the login page, session untouched.
    expect(screen.getByText(UNAVAILABLE)).toBeTruthy();
    expect(router.state.location.pathname).toBe('/devices');
    expect(onUnauthorized).not.toHaveBeenCalled();

    await advance(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(screen.getByText('Cihazlar sayfası')).toBeTruthy();
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(router.state.location.pathname).toBe('/devices');
    expect(queryClient.getQueryData(['me'])).toEqual(USER.user);
  });

  it('"Şimdi dene" retries at once and the waiting screen does not flash away', async () => {
    const fetchMock = mockMe(502, 502, 200);
    renderApp();
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Long before the 1 s retry is due.
    fireEvent.click(screen.getByRole('button', { name: 'Şimdi dene' }));
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText(UNAVAILABLE)).toBeTruthy();

    await advance(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Cihazlar sayfası')).toBeTruthy();
  });

  it('a 401 still means no session: straight to the login page, no retries', async () => {
    const fetchMock = mockMe(401);
    const { router } = renderApp();
    await advance(0);
    expect(screen.getByText('Giriş ekranı')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    await advance(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a 500 is a real error, not "unreachable": shown once with a retry button', async () => {
    mockMe(500);
    renderApp();
    await advance(0);
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(screen.getByText('Sunucu hatası')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tekrar dene' })).toBeTruthy();
  });
});
