import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/charts/styles.css';

import { createTheme, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { endSession } from './api/auth';
import { isApiError, setUnauthorizedHandler } from './api/client';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The live stream keeps devices and readings current.
      refetchOnWindowFocus: false,
      // A 4xx will not change by retrying; network and 5xx errors get one retry.
      retry: (failureCount, error) =>
        !(isApiError(error) && error.status >= 400 && error.status < 500) &&
        failureCount < 1,
    },
  },
});

setUnauthorizedHandler(() => endSession(queryClient));

const theme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'md',
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
