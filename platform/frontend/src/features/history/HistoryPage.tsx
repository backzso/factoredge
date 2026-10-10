import { Group, Paper, Select, Stack, Text, Title } from '@mantine/core';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useDevices, useReadings } from '../../api/devices';
import { HISTORY_MINUTES } from '../../api/queryKeys';
import { SIGNALS, type Signal } from '../../api/types';
import { EmptyState } from '../../components/EmptyState';
import { HealthBadge } from '../../components/badges';
import { PageLoader } from '../../components/PageLoader';
import { QueryError } from '../../components/QueryError';
import { SIGNAL_LABEL, SIGNAL_ORDER } from '../../lib/labels';
import { HistoryChart } from './HistoryChart';

const SIGNAL_OPTIONS = SIGNAL_ORDER.map((s) => ({ value: s, label: SIGNAL_LABEL[s] }));

function isSignal(value: string | null): value is Signal {
  return (SIGNALS as readonly string[]).includes(value ?? '');
}

export function HistoryPage() {
  const devices = useDevices();
  const [params, setParams] = useSearchParams();
  const requestedDevice = params.get('device');
  const signalParam = params.get('signal');
  const signal: Signal = isSignal(signalParam) ? signalParam : 'productionCount';

  const deviceList = devices.data ?? [];
  const device =
    deviceList.find((d) => d.id === requestedDevice) ?? deviceList[0] ?? null;
  const readings = useReadings(device?.id ?? null);

  const setParam = (key: 'device' | 'signal', value: string | null) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  // A selected device that was deleted falls back to the first one.
  useEffect(() => {
    if (requestedDevice && devices.data && !devices.data.some((d) => d.id === requestedDevice)) {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('device');
          return next;
        },
        { replace: true },
      );
    }
  }, [requestedDevice, devices.data, setParams]);

  return (
    <Stack>
      <Title order={2}>Geçmiş</Title>
      {devices.isPending ? (
        <PageLoader />
      ) : devices.isError ? (
        <QueryError error={devices.error} onRetry={() => void devices.refetch()} />
      ) : deviceList.length === 0 ? (
        <EmptyState title="Henüz cihaz yok">Geçmiş, cihaz eklendikten sonra görüntülenir.</EmptyState>
      ) : (
        <>
          <Group align="flex-end">
            <Select
              label="Cihaz"
              data={deviceList.map((d) => ({ value: d.id, label: d.name }))}
              value={device?.id ?? null}
              onChange={(value) => setParam('device', value)}
              allowDeselect={false}
              w={240}
            />
            <Select
              label="Sinyal"
              data={SIGNAL_OPTIONS}
              value={signal}
              onChange={(value) => setParam('signal', value)}
              allowDeselect={false}
              w={200}
            />
            {device && <HealthBadge status={device.health.status} />}
          </Group>

          <Paper withBorder p="md">
            <Text size="sm" c="dimmed" mb="sm">
              Son {HISTORY_MINUTES} dakika · {SIGNAL_LABEL[signal]}
            </Text>
            {readings.isPending ? (
              <PageLoader />
            ) : readings.isError ? (
              <QueryError error={readings.error} onRetry={() => void readings.refetch()} />
            ) : readings.data.length === 0 ? (
              <EmptyState title="Veri yok">
                Bu cihazdan son {HISTORY_MINUTES} dakikada veri gelmedi.
              </EmptyState>
            ) : (
              <HistoryChart readings={readings.data} signal={signal} />
            )}
          </Paper>
        </>
      )}
    </Stack>
  );
}
