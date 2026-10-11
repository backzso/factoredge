import { Button, Center, Group, Paper, Select, Stack, Table, Text, Title } from '@mantine/core';
import { useSearchParams } from 'react-router';
import { useDevices } from '../../api/devices';
import { useEvents } from '../../api/events';
import { EmptyState } from '../../components/EmptyState';
import { PageLoader } from '../../components/PageLoader';
import { QueryError } from '../../components/QueryError';
import { formatTimestamp } from '../../lib/format';
import { EventDeviceName, SeverityBadge } from './EventParts';
import { describeEvent, eventDetail } from './eventText';

/** The event log, newest first; new events appear on top as they happen. */
export function EventsPage() {
  const devices = useDevices();
  const [params, setParams] = useSearchParams();
  const deviceId = params.get('device');
  const events = useEvents(deviceId);

  const setDevice = (value: string | null) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set('device', value);
        else next.delete('device');
        return next;
      },
      { replace: true },
    );
  };

  const deviceOptions = (devices.data ?? []).map((d) => ({ value: d.id, label: d.name }));
  const items = events.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Title order={2}>Olaylar</Title>
        <Select
          w={220}
          label="Cihaz"
          placeholder="Tüm cihazlar"
          data={deviceOptions}
          value={deviceId}
          onChange={setDevice}
          clearable
        />
      </Group>

      {events.isPending ? (
        <PageLoader />
      ) : events.isError ? (
        <QueryError error={events.error} onRetry={() => void events.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="Henüz olay yok">
          Cihaz bağlantısı, arıza ve yönetim işlemleri burada listelenir.
        </EmptyState>
      ) : (
        <Paper withBorder>
          <Table.ScrollContainer minWidth={720}>
            <Table striped verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={170}>Zaman</Table.Th>
                  <Table.Th w={90}>Önem</Table.Th>
                  <Table.Th>Olay</Table.Th>
                  <Table.Th w={180}>Cihaz</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((event) => {
                  const detail = eventDetail(event);
                  return (
                    <Table.Tr key={event.id}>
                      <Table.Td style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {formatTimestamp(event.ts)}
                      </Table.Td>
                      <Table.Td>
                        <SeverityBadge severity={event.severity} />
                      </Table.Td>
                      <Table.Td>
                        {describeEvent(event)}
                        {detail && (
                          <Text size="xs" c="dimmed" lineClamp={1} title={detail}>
                            {detail}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <EventDeviceName event={event} />
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}

      {events.hasNextPage && (
        <Center>
          <Button
            variant="default"
            onClick={() => void events.fetchNextPage()}
            loading={events.isFetchingNextPage}
          >
            Daha fazla yükle
          </Button>
        </Center>
      )}
    </Stack>
  );
}
