import { Box, Card, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import type { ActiveAlarm, Device, ReadingDto } from '../../api/types';
import { HealthBadge, LineStateBadge, ProtocolBadge } from '../../components/badges';
import { RelativeTime } from '../../components/RelativeTime';
import {
  formatCount,
  formatCurrent,
  formatTemperature,
  formatThreshold,
} from '../../lib/format';
import { useShowingLastKnown } from '../../live/liveStatus';

interface DeviceCardProps {
  device: Device;
  reading: ReadingDto | undefined;
}

export function DeviceCard({ device, reading }: DeviceCardProps) {
  const lastKnown = useShowingLastKnown();
  // Current values only while the device is online and the stream is live.
  const current = device.health.status === 'ONLINE' && !lastKnown;
  const fault = reading?.state === 'FAULT';
  const alarm = device.alarm;
  // After a connector restart the backend reports lastSeenAt: null, but the last
  // reading is still known; its receivedAt is the same instant.
  const lastSeenAt = device.health.lastSeenAt ?? reading?.receivedAt ?? null;

  return (
    <Card
      withBorder
      padding="lg"
      style={
        fault || alarm
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
        <div style={{ opacity: current ? 1 : 0.5 }}>
          {reading ? <LineStateBadge state={reading.state} /> : null}
        </div>
      </Group>

      {alarm && (
        <AlarmStrip alarm={alarm} valueC={reading?.motorTempC} current={current} />
      )}

      {/* Not current: keep the last known values, dimmed. */}
      <SimpleGrid
        cols={2}
        mt="md"
        style={{ opacity: current ? 1 : 0.45 }}
        aria-label={current ? undefined : 'Son bilinen değerler'}
      >
        <Metric label="Üretim" value={formatCount(reading?.productionCount)} />
        <Metric label="Fire" value={formatCount(reading?.scrapCount)} />
        <Metric label="Sıcaklık" value={formatTemperature(reading?.motorTempC)} />
        <Metric label="Akım" value={formatCurrent(reading?.motorCurrentA)} />
      </SimpleGrid>

      <Text size="xs" c="dimmed" mt="md">
        Son veri: <RelativeTime value={lastSeenAt} />
        {lastKnown && ' · son bilinen durum'}
      </Text>
      {device.health.lastError && device.health.status !== 'ONLINE' && (
        <Text size="xs" c="red" mt={4} lineClamp={2} title={device.health.lastError}>
          {device.health.lastError}
        </Text>
      )}
    </Card>
  );
}

/**
 * The open temperature alarm. Like the health badge, it is drawn faded and
 * outlined, and says so, when it cannot be known to be current.
 */
function AlarmStrip({
  alarm,
  valueC,
  current,
}: {
  alarm: ActiveAlarm;
  valueC: number | undefined;
  current: boolean;
}) {
  return (
    <Box
      role="alert"
      mt="md"
      px="sm"
      py={6}
      data-last-known={current ? undefined : true}
      style={{
        borderRadius: 'var(--mantine-radius-sm)',
        ...(current
          ? { background: 'var(--mantine-color-red-filled)', color: 'var(--mantine-color-white)' }
          : {
              border: '1px dashed var(--mantine-color-red-6)',
              color: 'var(--mantine-color-red-6)',
              opacity: 0.6,
            }),
      }}
    >
      <Text fw={700} size="sm" inherit>
        Yüksek sıcaklık: {formatTemperature(valueC ?? alarm.peakC)} · eşik{' '}
        {formatThreshold(alarm.raiseC)}
      </Text>
      <Text size="xs" inherit style={{ opacity: 0.9 }}>
        Tepe {formatTemperature(alarm.peakC)} · <RelativeTime value={alarm.raisedAt} /> açıldı
        {!current && ' · son bilinen'}
      </Text>
    </Box>
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
