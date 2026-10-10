import { Tooltip } from '@mantine/core';
import { formatDateTime, formatRelative } from '../lib/format';
import { useNow } from '../lib/useNow';

/** "12 sn önce", re-rendered every second; the exact local time on hover. */
export function RelativeTime({ value }: { value: string | null | undefined }) {
  const now = useNow();
  if (!value) return <>—</>;
  return (
    <Tooltip label={formatDateTime(value)} withArrow>
      <span>{formatRelative(value, now)}</span>
    </Tooltip>
  );
}
