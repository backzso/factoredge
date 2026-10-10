import { Anchor, SimpleGrid, Stack, Title } from '@mantine/core';
import { Link } from 'react-router';
import { useCan } from '../../api/auth';
import { useDevices, useLatestReadings } from '../../api/devices';
import { EmptyState } from '../../components/EmptyState';
import { PageLoader } from '../../components/PageLoader';
import { QueryError } from '../../components/QueryError';
import { DeviceCard } from './DeviceCard';

export function DashboardPage() {
  const devices = useDevices();
  const { data: latest } = useLatestReadings();
  const canManage = useCan('manageDevices');

  return (
    <Stack>
      <Title order={2}>Panel</Title>
      {devices.isPending ? (
        <PageLoader />
      ) : devices.isError ? (
        <QueryError error={devices.error} onRetry={() => void devices.refetch()} />
      ) : devices.data.length === 0 ? (
        <EmptyState title="Henüz cihaz yok">
          {canManage ? (
            <>
              İzlemeye başlamak için{' '}
              <Anchor component={Link} to="/devices?new=1">
                cihaz ekleyin
              </Anchor>
              .
            </>
          ) : (
            'Bir yönetici cihaz eklediğinde burada görünecek.'
          )}
        </EmptyState>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>
          {devices.data.map((device) => (
            <DeviceCard key={device.id} device={device} reading={latest?.[device.id]} />
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}
