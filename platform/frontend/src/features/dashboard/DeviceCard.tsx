import { Card, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import type { Device, ReadingDto } from '../../api/types';
import { HealthBadge, LineStateBadge, ProtocolBadge } from '../../components/badges';
import { RelativeTime } from '../../components/RelativeTime';
import { formatCount, formatCurrent, formatTemperature } from '../../lib/format';

interface DeviceCardProps {
  device: Device;
  reading: ReadingDto | undefined;
}

export function DeviceCard({ device, reading }: DeviceCardProps) {
  const online = device.health.status === 'ONLINE';
  const fault = reading?.state === 'FAULT';
  // After a connector restart the backend reports lastSeenAt: null, but the last
  // reading is still known; its receivedAt is the same instant.
  const lastSeenAt = device.health.lastSeenAt ?? reading?.receivedAt ?? null;

  return (
    <Card
      withBorder
      padding="lg"
      style={
        fault
          ? { borderColor: 'var(--mantine-color-red-6)', borderWidth: 2 }
          : undefined
      }
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={4}>
          <Text fw={600} size="lg">
            {device.name}
          </Text>
          <Group gap={6}>
            <ProtocolBadge protocol={device.protocol} />
            <HealthBadge status={device.health.status} />
          </Group>
        </Stack>
        <div style={{ opacity: online ? 1 : 0.5 }}>
          {reading ? <LineStateBadge state={reading.state} /> : null}
        </div>
      </Group>

      {/* Not ONLINE: keep the last known values, dimmed. */}
      <SimpleGrid
        cols={2}
        mt="md"
        style={{ opacity: online ? 1 : 0.45 }}
        aria-label={online ? undefined : 'Son bilinen değerler'}
      >
        <Metric label="Üretim" value={formatCount(reading?.productionCount)} />
        <Metric label="Fire" value={formatCount(reading?.scrapCount)} />
        <Metric label="Sıcaklık" value={formatTemperature(reading?.motorTempC)} />
        <Metric label="Akım" value={formatCurrent(reading?.motorCurrentA)} />
      </SimpleGrid>

      <Text size="xs" c="dimmed" mt="md">
        Son veri: <RelativeTime value={lastSeenAt} />
      </Text>
      {device.health.lastError && !online && (
        <Text size="xs" c="red" mt={4} lineClamp={2} title={device.health.lastError}>
          {device.health.lastError}
        </Text>
      )}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="xl" fw={700} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Text>
    </div>
  );
}
