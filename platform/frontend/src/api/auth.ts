import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { backoffDelay } from '../lib/backoff';
import { api, ApiError, isServerUnavailable } from './client';
import { qk } from './queryKeys';
import { announceSession } from './sessionSync';
import type { AuthUser, Role } from './types';

/**
 * The logged-in user, or null without a session (401).
 *
 * An unreachable backend (network error, 502/503/504) is retried for as long as
 * it takes, with growing delays. The query stays pending meanwhile, so
 * RequireAuth neither ends the session nor redirects to the login page, and the
 * app continues where it was once the backend answers.
 */
export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: fetchMe,
    retry: (_failureCount, error) => isServerUnavailable(error),
    retryDelay: (failureCount) => backoffDelay(failureCount),
    // Also try while the browser reports offline: the failure is what shows
    // the "server unreachable" screen (a paused query would spin forever).
    networkMode: 'always',
    staleTime: Infinity,
  });
}

/**
 * Retries ['me'] immediately. A plain refetch() does nothing while a retry is
 * waiting (TanStack Query only continues the running retryer when there is no
 * data yet), so the waiting retry is cancelled first.
 */
export function useRetryMeNow(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.cancelQueries({ queryKey: qk.me });
    await queryClient.refetchQueries({ queryKey: qk.me });
  };
}

async function fetchMe(): Promise<AuthUser | null> {
  try {
    const { user } = await api<{ user: AuthUser }>('/auth/me', {
      authRedirect: false,
    });
    return user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: { username: string; password: string }) =>
      api<{ user: AuthUser }>('/auth/login', {
        method: 'POST',
        body: credentials,
        authRedirect: false,
      }),
    onSuccess: ({ user }) => {
      // Drop anything cached for a previous user before showing the app.
      queryClient.clear();
      queryClient.setQueryData(qk.me, user);
      announceSession({ type: 'login', userId: user.id });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<void>('/auth/logout', { method: 'POST', authRedirect: false }),
    // Leave the session locally even if the request failed.
    onSettled: () => {
      const me = queryClient.getQueryData<AuthUser | null>(qk.me);
      announceSession({ type: 'logout', userId: me?.id ?? null });
      endSession(queryClient);
    },
  });
}

/** Forgets every cached response and the user; RequireAuth then redirects to /login. */
export function endSession(
  queryClient: ReturnType<typeof useQueryClient>,
): void {
  // ['me'] is set rather than removed: removing a query does not notify its
  // observers, so RequireAuth would only notice on some unrelated re-render
  // (a tab told by another tab, or by the live stream, has none).
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== qk.me[0] });
  queryClient.setQueryData(qk.me, null);
}

export type Permission = 'manageDevices' | 'manageUsers';

/**
 * Every permission of the UI, per role. Reading (dashboard, history, devices,
 * events) needs none. Mirrors the @Roles() of the backend controllers.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: ['manageDevices', 'manageUsers'],
  ENGINEER: ['manageDevices'],
  VIEWER: [],
};

export function can(user: AuthUser | null | undefined, permission: Permission): boolean {
  return !!user && ROLE_PERMISSIONS[user.role].includes(permission);
}

/** The single role check of the UI. The backend enforces the same rules. */
export function useCan(permission: Permission): boolean {
  const { data: user } = useMe();
  return can(user, permission);
}
