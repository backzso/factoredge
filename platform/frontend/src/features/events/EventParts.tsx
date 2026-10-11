import { Badge, Text } from '@mantine/core';
import type { EventDto, Severity } from '../../api/types';
import { eventDevice, SEVERITY } from './eventText';

export function SeverityBadge({ severity, size = 'sm' }: { severity: Severity; size?: 'xs' | 'sm' }) {
  const { label, color } = SEVERITY[severity] ?? SEVERITY.INFO;
  return (
    <Badge color={color} variant={severity === 'CRITICAL' ? 'filled' : 'light'} size={size}>
      {label}
    </Badge>
  );
}

/** The device as named when the event happened; dimmed if it has been deleted since. */
export function EventDeviceName({ event }: { event: EventDto }) {
  const device = eventDevice(event);
  if (!device) return <Text span inherit c="dimmed">—</Text>;
  return device.deleted ? (
    <Text span inherit c="dimmed" title="Bu cihaz silinmiş">
      {device.name} (silindi)
    </Text>
  ) : (
    <Text span inherit>{device.name}</Text>
  );
}
