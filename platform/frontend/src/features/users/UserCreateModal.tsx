import { Alert, Button, Group, Modal, PasswordInput, Select, Stack, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useState } from 'react';
import { isApiError } from '../../api/client';
import { translateApiMessage } from '../../api/errors';
import type { Role } from '../../api/types';
import { useCreateUser } from '../../api/users';
import { notifyError, notifySuccess } from '../../components/notify';
import { issuesFromError, mapIssuesToForm } from '../../lib/issueMapping';
import { ROLE_OPTIONS } from '../../lib/labels';

const FIELDS = ['username', 'password', 'role'];

export function UserCreateModal({ onClose }: { onClose: () => void }) {
  const create = useCreateUser();
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const form = useForm<{ username: string; password: string; role: Role }>({
    initialValues: { username: '', password: '', role: 'VIEWER' },
    validate: {
      username: (v) => (v.trim() ? null : 'Kullanıcı adı gerekli'),
      password: (v) => (v ? null : 'Parola gerekli'),
    },
  });

  const submit = form.onSubmit((values) => {
    setFormErrors([]);
    create.mutate(
      { ...values, username: values.username.trim() },
      {
        onSuccess: (user) => {
          notifySuccess(`${user.username} eklendi.`);
          onClose();
        },
        onError: (error) => {
          if (isApiError(error) && error.status === 400) {
            const mapped = mapIssuesToForm(issuesFromError(error, FIELDS), (p) => FIELDS.includes(p));
            form.setErrors(mapped.fieldErrors);
            setFormErrors(mapped.formErrors);
          } else if (isApiError(error) && error.status === 409) {
            form.setFieldError('username', translateApiMessage(error.message));
          } else {
            notifyError(error);
          }
        },
      },
    );
  });

  return (
    <Modal opened onClose={onClose} title="Kullanıcı ekle">
      <form onSubmit={submit} noValidate>
        <Stack>
          {formErrors.length > 0 && <Alert color="red">{formErrors.join('\n')}</Alert>}
          <TextInput
            label="Kullanıcı adı"
            description="3-32 karakter: harf, rakam, _ . -"
            autoComplete="off"
            required
            {...form.getInputProps('username')}
          />
          <PasswordInput
            label="Parola"
            description="8-72 bayt"
            autoComplete="new-password"
            required
            {...form.getInputProps('password')}
          />
          <Select label="Rol" data={ROLE_OPTIONS} allowDeselect={false} {...form.getInputProps('role')} />
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onClose} disabled={create.isPending}>
              Vazgeç
            </Button>
            <Button type="submit" loading={create.isPending}>
              Ekle
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
