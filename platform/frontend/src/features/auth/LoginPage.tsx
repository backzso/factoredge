import {
  Alert,
  Button,
  Center,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useLogin, useMe } from '../../api/auth';
import { isApiError } from '../../api/client';
import { describeError } from '../../api/errors';
import type { LoginRedirectState } from './guards';

export function LoginPage() {
  const me = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as LoginRedirectState | null)?.from ?? '/';

  const form = useForm({
    initialValues: { username: '', password: '' },
    validate: {
      username: (v) => (v.trim() ? null : 'Kullanıcı adı gerekli'),
      password: (v) => (v ? null : 'Parola gerekli'),
    },
  });

  if (me.data) {
    return <Navigate to={from} replace />;
  }

  const submit = form.onSubmit((values) => {
    login.mutate(
      { username: values.username.trim(), password: values.password },
      { onSuccess: () => void navigate(from, { replace: true }) },
    );
  });

  return (
    <Center mih="100vh" p="md">
      <Paper withBorder shadow="sm" p="xl" w={380}>
        <form onSubmit={submit} noValidate>
          <Stack>
            <div>
              <Title order={2}>FactorEdge</Title>
              <Text c="dimmed" size="sm">
                Üretim bantları izleme platformu
              </Text>
            </div>
            {login.isError && <LoginError error={login.error} />}
            <TextInput
              label="Kullanıcı adı"
              autoComplete="username"
              autoFocus
              {...form.getInputProps('username')}
            />
            <PasswordInput
              label="Parola"
              autoComplete="current-password"
              {...form.getInputProps('password')}
            />
            <Button type="submit" loading={login.isPending} fullWidth>
              Giriş yap
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}

function LoginError({ error }: { error: unknown }) {
  if (isApiError(error) && error.status === 401) {
    return <Alert color="red">Kullanıcı adı veya parola hatalı.</Alert>;
  }
  const { title, message } = describeError(error);
  return (
    <Alert color="red" title={title}>
      {message}
    </Alert>
  );
}
