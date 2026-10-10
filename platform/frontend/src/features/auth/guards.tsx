import { Button, Center, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import { type ReactNode, useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { type Permission, useCan, useMe, useRetryMeNow } from '../../api/auth';
import { isServerUnavailable } from '../../api/client';
import { PageLoader } from '../../components/PageLoader';
import { QueryError } from '../../components/QueryError';

export interface LoginRedirectState {
  from?: string;
}

/**
 * Renders children only with a session; otherwise sends the user to /login and
 * back afterwards. Only a 401 (me = null) means "no session": an unreachable
 * backend shows a waiting screen while ['me'] keeps retrying, and the requested
 * page opens as soon as the backend answers.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const retryNow = useRetryMeNow();
  const location = useLocation();

  // Sticky until the query settles: a new attempt resets failureCount, and the
  // screen should not flash back to a spinner on every retry.
  const unavailableNow =
    me.isPending && me.failureCount > 0 && isServerUnavailable(me.failureReason);
  const [unavailable, setUnavailable] = useState(false);
  if (unavailableNow && !unavailable) setUnavailable(true);
  if (!me.isPending && unavailable) setUnavailable(false);

  if (me.isPending) {
    return unavailable || unavailableNow ? (
      <ServerUnavailable onRetryNow={() => void retryNow()} />
    ) : (
      <PageLoader />
    );
  }
  if (me.isError) {
    return (
      <Center mih="100vh" p="md">
        <QueryError error={me.error} onRetry={() => void me.refetch()} />
      </Center>
    );
  }
  if (!me.data) {
    const state: LoginRedirectState = {
      from: location.pathname + location.search,
    };
    return <Navigate to="/login" replace state={state} />;
  }
  return <>{children}</>;
}

function ServerUnavailable({ onRetryNow }: { onRetryNow: () => void }) {
  return (
    <Center mih="100vh" p="md">
      <Paper withBorder p="xl" maw={440} role="status" aria-live="polite">
        <Stack align="center" gap="sm">
          <Loader size="sm" />
          <Title order={3} ta="center">
            Sunucuya ulaşılamadı, yeniden deneniyor
          </Title>
          <Text c="dimmed" size="sm" ta="center">
            Bağlantı kurulduğunda kaldığınız sayfa açılacak. Oturumunuz korunuyor.
          </Text>
          <Button variant="light" size="xs" onClick={onRetryNow}>
            Şimdi dene
          </Button>
        </Stack>
      </Paper>
    </Center>
  );
}

/** A page the role may not see (e.g. a VIEWER typing /users) redirects to the dashboard. */
export function RequireCan({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const allowed = useCan(permission);
  return allowed ? <>{children}</> : <Navigate to="/" replace />;
}
