import { createBrowserRouter, Navigate } from 'react-router';
import { LoginPage } from './features/auth/LoginPage';
import { RequireAuth, RequireCan } from './features/auth/guards';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { DevicesPage } from './features/devices/DevicesPage';
import { AppLayout } from './features/layout/AppLayout';
import { UsersPage } from './features/users/UsersPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      {
        path: 'history',
        // Recharts is only needed here: keep it out of the main bundle.
        lazy: async () => ({
          Component: (await import('./features/history/HistoryPage')).HistoryPage,
        }),
      },
      { path: 'devices', element: <DevicesPage /> },
      {
        path: 'users',
        element: (
          <RequireCan permission="manageUsers">
            <UsersPage />
          </RequireCan>
        ),
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
