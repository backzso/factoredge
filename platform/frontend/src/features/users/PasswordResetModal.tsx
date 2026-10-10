import { Button, Group, Modal, PasswordInput, Stack, Text } from '@mantine/core';
import { useForm } from '@mantine/form';
import { isApiError } from '../../api/client';
import type { PublicUser } from '../../api/types';
import { useUpdateUser } from '../../api/users';
import { notifyError, notifySuccess } from '../../components/notify';
import { issuesFromError, mapIssuesToForm } from '../../lib/issueMapping';

export function PasswordResetModal({ user, onClose }: { user: PublicUser; onClose: () => void }) {
  const update = useUpdateUser();
  const form = useForm({
    initialValues: { password: '', confirm: '' },
    validate: {
      password: (v) => (v ? null : 'Parola gerekli'),
      confirm: (v, values) => (v === values.password ? null : 'Parolalar eşleşmiyor'),
    },
  });

  const submit = form.onSubmit(({ password }) => {
    update.mutate(
      { id: user.id, update: { password } },
      {
        onSuccess: () => {
          notifySuccess(`${user.username} için parola değiştirildi.`);
          onClose();
        },
        onError: (error) => {
          if (isApiError(error) && error.status === 400) {
            const mapped = mapIssuesToForm(issuesFromError(error, ['password']), (p) => p === 'password');
            form.setErrors(mapped.fieldErrors);
            if (mapped.formErrors.length > 0) notifyError(error);
          } else {
            notifyError(error);
          }
        },
      },
    );
  });

  return (
    <Modal opened onClose={onClose} title="Parola sıfırla">
      <form onSubmit={submit} noValidate>
        <Stack>
          <Text size="sm">
            <b>{user.username}</b> için yeni parola belirleyin.
          </Text>
          <PasswordInput
            label="Yeni parola"
            description="8-72 bayt"
            autoComplete="new-password"
            required
            {...form.getInputProps('password')}
          />
          <PasswordInput
            label="Yeni parola (tekrar)"
            autoComplete="new-password"
            required
            {...form.getInputProps('confirm')}
          />
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onClose} disabled={update.isPending}>
              Vazgeç
            </Button>
            <Button type="submit" loading={update.isPending}>
              Kaydet
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
