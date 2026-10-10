import { Badge } from '@mantine/core';
import type { LiveStatus } from '../../live/useLiveStream';

const VIEW: Record<LiveStatus, { label: string; color: string }> = {
  connecting: { label: 'Bağlanıyor', color: 'gray' },
  live: { label: 'Canlı', color: 'green' },
  reconnecting: { label: 'Yeniden bağlanıyor', color: 'yellow' },
};

export function LiveIndicator({ status }: { status: LiveStatus }) {
  const { label, color } = VIEW[status];
  return (
    <Badge
      color={color}
      variant="dot"
      size="lg"
      title="Canlı veri akışı (SSE) bağlantısı"
      aria-live="polite"
    >
      {label}
    </Badge>
  );
}
