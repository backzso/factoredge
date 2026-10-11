import type { InfiniteData } from '@tanstack/react-query';
import type { EventDto, EventPage } from '../api/types';

// Pure cache updates for live event-log entries. Events arrive in the order
// they were recorded, so prepending keeps the lists newest first. An entry
// already present (e.g. part of a REST response that raced the stream) is
// ignored; an unloaded cache is returned as is.

export type EventPages = InfiniteData<EventPage, string | null>;

/**
 * Prepends to the first page of the events page's infinite query. `deviceId`
 * is the page's filter: an event of another device is left out. The cursors of
 * the loaded pages stay valid, since they point at older events.
 */
export function prependEventToPages(
  data: EventPages | undefined,
  event: EventDto,
  deviceId: string | null,
): EventPages | undefined {
  if (!data || data.pages.length === 0) return data;
  if (deviceId !== null && event.deviceId !== deviceId) return data;
  if (data.pages.some((page) => page.items.some((e) => e.id === event.id))) return data;
  const [first, ...rest] = data.pages;
  return {
    ...data,
    pages: [{ ...first!, items: [event, ...first!.items] }, ...rest],
  };
}

/** The dashboard's short list: prepend, keep the newest `limit`. */
export function prependRecent(
  list: EventDto[] | undefined,
  event: EventDto,
  limit: number,
): EventDto[] | undefined {
  if (!list || list.some((e) => e.id === event.id)) return list;
  return [event, ...list].slice(0, limit);
}
