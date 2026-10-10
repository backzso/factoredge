import { Badge } from '@mantine/core';
import type { HealthStatus, LineState, Protocol } from '../api/types';
import { HEALTH, LINE_STATE, PROTOCOL } from '../lib/labels';

export function HealthBadge({ status }: { status: HealthStatus }) {
  const { label, color } = HEALTH[status];
  return (
    <Badge color={color} variant="light">
      {label}
    </Badge>
  );
}

export function ProtocolBadge({ protocol }: { protocol: Protocol }) {
  const { label, color } = PROTOCOL[protocol];
  return (
    <Badge color={color} variant="outline">
      {label}
    </Badge>
  );
}

/** A fault is drawn filled and larger so it stands out on the dashboard. */
export function LineStateBadge({
  state,
  size = 'md',
}: {
  state: LineState;
  size?: 'md' | 'lg';
}) {
  const { label, color } = LINE_STATE[state];
  const fault = state === 'FAULT';
  return (
    <Badge color={color} variant={fault ? 'filled' : 'light'} size={fault ? 'lg' : size}>
      {label}
    </Badge>
  );
}
