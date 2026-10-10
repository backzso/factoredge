import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { type Permission, useCan, useMe } from '../../api/auth';
import { PageLoader } from '../../components/PageLoader';
import { QueryError } from '../../components/QueryError';

export interface LoginRedirectState {
  from?: string;
}

/** Renders children only with a session; otherwise sends the user to /login and back afterwards. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) return <PageLoader />;
  if (me.isError) return <QueryError error={me.error} onRetry={() => void me.refetch()} />;
  if (!me.data) {
    const state: LoginRedirectState = {
      from: location.pathname + location.search,
    };
    return <Navigate to="/login" replace state={state} />;
  }
  return <>{children}</>;
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
