import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { qk, RECENT_EVENTS_LIMIT } from '../api/queryKeys';
import type { EventDto } from '../api/types';
import { applyLiveEvent } from './applyLiveEvent';
import { type EventPages, prependEventToPages, prependRecent } from './eventReducers';

function event(id: string, deviceId: string | null = 'd1'): EventDto {
  return {
    id,
    ts: '2026-10-11T10:00:00.000Z',
    type: 'line.fault_started',
    severity: 'CRITICAL',
    deviceId,
    data: { deviceName: 'Bant 1', previousState: 'RUNNING' },
  };
}

function pages(...ids: string[][]): EventPages {
  return {
    pages: ids.map((page, i) => ({
      items: page.map((id) => event(id)),
      nextCursor: i < ids.length - 1 ? `c${i}` : null,
    })),
    pageParams: ids.map((_, i) => (i === 0 ? null : `c${i - 1}`)),
  };
}

const idsOf = (data: EventPages | undefined) => data?.pages.map((p) => p.items.map((e) => e.id));

describe('prependEventToPages', () => {
  it('puts a new event on top of the first page and keeps the cursors', () => {
    const next = prependEventToPages(pages(['b', 'a'], ['z']), event('c'), null);
    expect(idsOf(next)).toEqual([['c', 'b', 'a'], ['z']]);
    expect(next?.pages[0]?.nextCursor).toBe('c0');
    expect(next?.pageParams).toEqual([null, 'c0']);
  });

  it('ignores an event already listed, on any page', () => {
    const data = pages(['b'], ['a']);
    expect(prependEventToPages(data, event('a'), null)).toBe(data);
  });

  it("leaves out another device's event when filtered, keeps it unfiltered", () => {
    const data = pages(['a']);
    expect(prependEventToPages(data, event('b', 'd2'), 'd1')).toBe(data);
    expect(prependEventToPages(data, event('c', null), 'd1')).toBe(data);
    expect(idsOf(prependEventToPages(data, event('b', 'd1'), 'd1'))).toEqual([['b', 'a']]);
    expect(idsOf(prependEventToPages(data, event('b', 'd2'), null))).toEqual([['b', 'a']]);
  });

  it('leaves an unloaded query alone', () => {
    expect(prependEventToPages(undefined, event('a'), null)).toBeUndefined();
  });
});

describe('prependRecent', () => {
  it('keeps the newest `limit` events', () => {
    const list = ['c', 'b', 'a'].map((id) => event(id));
    expect(prependRecent(list, event('d'), 3)?.map((e) => e.id)).toEqual(['d', 'c', 'b']);
    expect(prependRecent(list, event('b'), 3)).toBe(list);
    expect(prependRecent(undefined, event('d'), 3)).toBeUndefined();
  });
});

describe('applyLiveEvent: event', () => {
  it('updates every loaded event query according to its filter', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(qk.events(null), pages(['a']));
    queryClient.setQueryData(qk.events('d1'), pages(['a']));
    queryClient.setQueryData(qk.events('d2'), pages([]));
    queryClient.setQueryData(qk.recentEvents, [event('a')]);

    applyLiveEvent(queryClient, { type: 'event', data: event('b', 'd1') }, Date.now());

    expect(idsOf(queryClient.getQueryData(qk.events(null)))).toEqual([['b', 'a']]);
    expect(idsOf(queryClient.getQueryData(qk.events('d1')))).toEqual([['b', 'a']]);
    expect(idsOf(queryClient.getQueryData(qk.events('d2')))).toEqual([[]]);
    expect(queryClient.getQueryData<EventDto[]>(qk.recentEvents)?.map((e) => e.id)).toEqual([
      'b',
      'a',
    ]);
    expect(RECENT_EVENTS_LIMIT).toBe(8);
  });
});

describe('applyLiveEvent: device-removed', () => {
  it('reloads the event lists, whose entries lose the device id', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(qk.events(null), pages(['a']));
    queryClient.setQueryData(qk.recentEvents, [event('a')]);

    applyLiveEvent(queryClient, { type: 'device-removed', data: { deviceId: 'd1' } }, Date.now());

    expect(queryClient.getQueryState(qk.events(null))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(qk.recentEvents)?.isInvalidated).toBe(true);
  });
});
