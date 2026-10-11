import { createBrowserRouter, Navigate } from 'react-router';
import { LoginPage } from './features/auth/LoginPage';
import { RequireAuth, RequireCan } from './features/auth/guards';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { DevicesPage } from './features/devices/DevicesPage';
import { EventsPage } from './features/events/EventsPage';
import { AppLayout } from './features/layout/AppLayout';
import { RouteError } from './features/layout/RouteError';
import { UsersPage } from './features/users/UsersPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <RouteError fullPage /> },
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    // Last resort: the layout itself failed.
    errorElement: <RouteError fullPage />,
    children: [
      {
        // A crashing page is replaced inside the layout's <Outlet>; the rest of
        // the app keeps working.
        errorElement: <RouteError />,
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
          { path: 'events', element: <EventsPage /> },
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
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
