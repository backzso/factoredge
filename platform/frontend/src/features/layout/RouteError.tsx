import { Alert, Button, Center, Code, Stack, Text } from '@mantine/core';
import { isRouteErrorResponse, useLocation, useNavigate, useRouteError } from 'react-router';

/**
 * Error element of the routes. Inside the layout only the crashed page is
 * replaced; the menu, header and live stream keep running.
 *
 * "Yeniden dene" navigates to the same address: React Router resets a route's
 * error boundary when the location changes, so the page mounts again without
 * reloading the app.
 */
export function RouteError({ fullPage = false }: { fullPage?: boolean }) {
  const error = useRouteError();
  const navigate = useNavigate();
  const location = useLocation();

  const retry = () =>
    void navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: location.state,
    });

  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error);

  const content = (
    <Alert color="red" title={notFound ? 'Sayfa bulunamadı' : 'Bu sayfa görüntülenirken bir hata oluştu'} maw={640}>
      <Stack gap="sm">
        <Text size="sm">
          {notFound
            ? 'Aradığınız sayfa yok.'
            : 'Sayfayı yeniden yüklemeyi deneyebilirsiniz. Sorun sürerse sistem yöneticinize bildirin.'}
        </Text>
        {import.meta.env.DEV && !notFound && (
          <Code block style={{ whiteSpace: 'pre-wrap' }}>
            {detail}
          </Code>
        )}
        <div>
          <Button size="xs" color="red" variant="light" onClick={retry}>
            Yeniden dene
          </Button>
        </div>
      </Stack>
    </Alert>
  );

  return fullPage ? (
    <Center mih="100vh" p="md">
      {content}
    </Center>
  ) : (
    content
  );
}
