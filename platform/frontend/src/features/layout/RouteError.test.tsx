// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { installDomShims } from '../../test/domSetup';
import { RouteError } from './RouteError';

let shouldThrow = true;
function FlakyPage(): React.ReactElement {
  if (shouldThrow) throw new Error('chart exploded');
  return <p>Sayfa içeriği</p>;
}

function Layout() {
  return (
    <div>
      <nav>Menü</nav>
      <Outlet />
    </div>
  );
}

// Same shape as src/router.tsx: page errors are caught inside the layout.
function renderApp() {
  const router = createMemoryRouter(
    [
      {
        element: <Layout />,
        errorElement: <RouteError fullPage />,
        children: [{ errorElement: <RouteError />, children: [{ path: '/history', element: <FlakyPage /> }] }],
      },
    ],
    { initialEntries: ['/history'] },
  );
  return render(
    <MantineProvider>
      <RouterProvider router={router} />
    </MantineProvider>,
  );
}

describe('RouteError', () => {
  beforeAll(() => installDomShims());
  afterEach(() => cleanup());

  it('replaces only the crashed page, keeps the layout, and recovers on retry', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    shouldThrow = true;
    renderApp();

    expect(screen.getByText('Menü')).toBeTruthy();
    expect(screen.getByText('Bu sayfa görüntülenirken bir hata oluştu')).toBeTruthy();
    expect(screen.queryByText('Sayfa içeriği')).toBeNull();

    shouldThrow = false;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yeniden dene' }));
    });

    expect(screen.getByText('Sayfa içeriği')).toBeTruthy();
    expect(screen.getByText('Menü')).toBeTruthy();
    expect(screen.queryByText('Bu sayfa görüntülenirken bir hata oluştu')).toBeNull();
    spy.mockRestore();
  });
});
