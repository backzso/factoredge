import { Button, Group, Select, Stack, Table, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { useMe } from '../../api/auth';
import { useDeleteUser, useUpdateUser, useUsers } from '../../api/users';
import type { PublicUser, Role } from '../../api/types';
import { ConfirmModal } from '../../components/ConfirmModal';
import { notifyError, notifySuccess } from '../../components/notify';
import { PageLoader } from '../../components/PageLoader';
import { QueryError } from '../../components/QueryError';
import { formatDateTime } from '../../lib/format';
import { ROLE_LABEL, ROLE_OPTIONS } from '../../lib/labels';
import { PasswordResetModal } from './PasswordResetModal';
import { UserCreateModal } from './UserCreateModal';

export function UsersPage() {
  const users = useUsers();
  const { data: me } = useMe();
  const update = useUpdateUser();
  const remove = useDeleteUser();

  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<PublicUser | null>(null);
  const [toDelete, setToDelete] = useState<PublicUser | null>(null);

  const changeRole = (user: PublicUser, role: Role) => {
    if (role === user.role) return;
    update.mutate(
      { id: user.id, update: { role } },
      {
        onSuccess: () => notifySuccess(`${user.username} artık ${ROLE_LABEL[role]}.`),
        onError: notifyError,
      },
    );
  };

  const confirmDelete = () => {
    if (!toDelete) return;
    const { id, username } = toDelete;
    remove.mutate(id, {
      onSuccess: () => notifySuccess(`${username} silindi.`),
      onError: notifyError,
      onSettled: () => setToDelete(null),
    });
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Kullanıcılar</Title>
        <Button onClick={() => setCreating(true)}>Kullanıcı ekle</Button>
      </Group>

      {users.isPending ? (
        <PageLoader />
      ) : users.isError ? (
        <QueryError error={users.error} onRetry={() => void users.refetch()} />
      ) : (
        <Table.ScrollContainer minWidth={640}>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Kullanıcı adı</Table.Th>
                <Table.Th>Rol</Table.Th>
                <Table.Th>Oluşturulma</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {users.data.map((user) => {
                const isMe = user.id === me?.id;
                const roleBusy = update.isPending && update.variables?.id === user.id && !!update.variables.update.role;
                return (
                  <Table.Tr key={user.id}>
                    <Table.Td fw={500}>
                      {user.username}
                      {isMe && (
                        <Text span c="dimmed" size="sm">
                          {' '}
                          (siz)
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Select
                        size="xs"
                        w={140}
                        data={ROLE_OPTIONS}
                        value={user.role}
                        allowDeselect={false}
                        disabled={roleBusy}
                        aria-label={`${user.username} rolü`}
                        onChange={(value) => value && changeRole(user, value as Role)}
                      />
                    </Table.Td>
                    <Table.Td>{formatDateTime(user.createdAt)}</Table.Td>
                    <Table.Td>
                      <Group gap="xs" justify="flex-end" wrap="nowrap">
                        <Button size="xs" variant="default" onClick={() => setResetFor(user)}>
                          Parola sıfırla
                        </Button>
                        <Button
                          size="xs"
                          variant="light"
                          color="red"
                          disabled={isMe}
                          title={isMe ? 'Kendi hesabınızı silemezsiniz' : undefined}
                          onClick={() => setToDelete(user)}
                        >
                          Sil
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {creating && <UserCreateModal onClose={() => setCreating(false)} />}
      {resetFor && <PasswordResetModal user={resetFor} onClose={() => setResetFor(null)} />}

      <ConfirmModal
        opened={toDelete !== null}
        title="Kullanıcıyı sil"
        loading={remove.isPending}
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      >
        <b>{toDelete?.username}</b> kullanıcısı silinecek. Bu işlem geri alınamaz.
      </ConfirmModal>
    </Stack>
  );
}
