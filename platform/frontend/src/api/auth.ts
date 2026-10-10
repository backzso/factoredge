import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './client';
import { qk } from './queryKeys';
import type { AuthUser } from './types';

/** The logged-in user, or null without a session. */
export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: fetchMe,
    retry: false,
    staleTime: Infinity,
  });
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
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<void>('/auth/logout', { method: 'POST', authRedirect: false }),
    // Leave the session locally even if the request failed.
    onSettled: () => endSession(queryClient),
  });
}

/** Forgets every cached response and the user; RequireAuth then redirects to /login. */
export function endSession(
  queryClient: ReturnType<typeof useQueryClient>,
): void {
  queryClient.clear();
  queryClient.setQueryData(qk.me, null);
}

export type Permission = 'manageDevices' | 'manageUsers';

const PERMISSIONS: Record<Permission, ReadonlyArray<AuthUser['role']>> = {
  manageDevices: ['ADMIN'],
  manageUsers: ['ADMIN'],
};

export function can(user: AuthUser | null | undefined, permission: Permission): boolean {
  return !!user && PERMISSIONS[permission].includes(user.role);
}

/** The single role check of the UI. The backend enforces the same rules. */
export function useCan(permission: Permission): boolean {
  const { data: user } = useMe();
  return can(user, permission);
}
