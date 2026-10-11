import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from './client';
import { qk, RECENT_EVENTS_LIMIT } from './queryKeys';
import type { EventDto, EventPage } from './types';

const PAGE_SIZE = 50;

function eventsUrl(params: { limit: number; before?: string | null; deviceId?: string | null }): string {
  const search = new URLSearchParams({ limit: String(params.limit) });
  if (params.before) search.set('before', params.before);
  if (params.deviceId) search.set('deviceId', params.deviceId);
  return `/events?${search.toString()}`;
}

/**
 * The event log, newest first, one page at a time. Kept current by the live
 * stream (new events are prepended), so it is never refetched on its own.
 */
export function useEvents(deviceId: string | null) {
  return useInfiniteQuery({
    queryKey: qk.events(deviceId),
    queryFn: ({ pageParam }) =>
      api<EventPage>(eventsUrl({ limit: PAGE_SIZE, before: pageParam, deviceId })),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: Infinity,
  });
}

/** The latest few events for the dashboard; also kept current by the stream. */
export function useRecentEvents() {
  return useQuery({
    queryKey: qk.recentEvents,
    queryFn: async () =>
      (await api<EventPage>(eventsUrl({ limit: RECENT_EVENTS_LIMIT }))).items satisfies EventDto[],
    staleTime: Infinity,
  });
}
