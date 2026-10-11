import { Anchor, Card, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router';
import { useRecentEvents } from '../../api/events';
import { QueryError } from '../../components/QueryError';
import { formatTime, formatTimestamp } from '../../lib/format';
import { SeverityBadge } from '../events/EventParts';
import { describeEvent } from '../events/eventText';

/** The latest events under the dashboard, so a demo needs no page change. */
export function RecentEvents() {
  const events = useRecentEvents();

  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="sm">
        <Title order={4}>Son olaylar</Title>
        <Anchor component={Link} to="/events" size="sm">
          Tümü →
        </Anchor>
      </Group>
      {events.isPending ? (
        <Loader size="sm" />
      ) : events.isError ? (
        <QueryError error={events.error} onRetry={() => void events.refetch()} />
      ) : events.data.length === 0 ? (
        <Text c="dimmed" size="sm">
          Henüz olay yok.
        </Text>
      ) : (
        <Stack gap={6}>
          {events.data.map((event) => (
            <Group key={event.id} gap="sm" wrap="nowrap" align="center">
              <Text
                size="xs"
                c="dimmed"
                w={56}
                style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
                title={formatTimestamp(event.ts)}
              >
                {formatTime(event.ts)}
              </Text>
              <div style={{ flexShrink: 0, width: 64 }}>
                <SeverityBadge severity={event.severity} size="xs" />
              </div>
              <Text size="sm" lineClamp={1} title={describeEvent(event)}>
                {describeEvent(event)}
              </Text>
            </Group>
          ))}
        </Stack>
      )}
    </Card>
  );
}
