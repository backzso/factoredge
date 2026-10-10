import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { qk } from './queryKeys';
import type { PublicUser, Role } from './types';

export function useUsers() {
  return useQuery({
    queryKey: qk.users,
    queryFn: () => api<PublicUser[]>('/users'),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { username: string; password: string; role: Role }) =>
      api<PublicUser>('/users', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.users }),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      update,
    }: {
      id: string;
      update: { role?: Role; password?: string };
    }) =>
      api<PublicUser>(`/users/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: update,
      }),
    onSuccess: async (_user, { id }) => {
      await queryClient.invalidateQueries({ queryKey: qk.users });
      // Changing one's own role changes what the UI may show.
      const me = queryClient.getQueryData<{ id: string } | null>(qk.me);
      if (me?.id === id) {
        await queryClient.invalidateQueries({ queryKey: qk.me });
      }
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.users }),
  });
}
