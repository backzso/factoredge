import { Badge, Tooltip } from '@mantine/core';
import type { HealthStatus, LineState, Protocol } from '../api/types';
import { HEALTH, LINE_STATE, PROTOCOL } from '../lib/labels';
import { useShowingLastKnown } from '../live/liveStatus';

export const LAST_KNOWN_HINT = 'Son bilinen durum: canlı bağlantı yok';

/**
 * Device health. Without a live connection the badge is drawn faded and
 * outlined, and says it is the last known state: a green "Çevrimiçi" must not
 * look current when nobody can know.
 */
export function HealthBadge({ status }: { status: HealthStatus }) {
  const { label, color } = HEALTH[status];
  const lastKnown = useShowingLastKnown();
  if (!lastKnown) {
    return (
      <Badge color={color} variant="light">
        {label}
      </Badge>
    );
  }
  return (
    <Tooltip label={LAST_KNOWN_HINT} withArrow>
      <Badge
        color={color}
        variant="outline"
        style={{ opacity: 0.5, borderStyle: 'dashed' }}
        aria-label={`${label} (son bilinen)`}
        data-last-known
      >
        {label}
      </Badge>
    </Tooltip>
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
