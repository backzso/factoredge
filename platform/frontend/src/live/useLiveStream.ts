import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiError, notifyUnauthorized } from '../api/client';
import { type LiveEvent, LIVE_EVENT_TYPES } from '../api/types';
import { applyLiveEvent } from './applyLiveEvent';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting';

/** Delays before reopening a stream the browser gave up on; the last one repeats. */
const REOPEN_DELAYS_MS = [1_000, 2_000, 5_000, 10_000];

/**
 * The one EventSource of the app, mounted by the layout while logged in.
 *
 * - The browser reconnects by itself after a dropped connection
 *   (readyState CONNECTING); the snapshot sent on every (re)connect repairs the cache.
 * - If the stream is closed for good (readyState CLOSED: a non-200 answer such
 *   as 401, or the dev proxy's 502 while the backend is down), /auth/me tells
 *   whether the session ended. If it did, the 401 handler sends the user to the
 *   login page; otherwise the stream is reopened with a growing delay.
 */
export function useLiveStream(): LiveStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('connecting');

  useEffect(() => {
    let source: EventSource | undefined;
    let reopenTimer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let disposed = false;

    const handleEvent = (type: LiveEvent['type']) => (message: MessageEvent<string>) => {
      let data: unknown;
      try {
        data = JSON.parse(message.data);
      } catch {
        console.warn(`live: unparsable ${type} event`, message.data);
        return;
      }
      applyLiveEvent(queryClient, { type, data } as LiveEvent, Date.now());
    };

    const open = () => {
      source = new EventSource('/api/stream');
      source.addEventListener('open', () => {
        failures = 0;
        setStatus('live');
      });
      for (const type of LIVE_EVENT_TYPES) {
        source.addEventListener(type, handleEvent(type));
      }
      source.addEventListener('error', () => {
        if (disposed) return;
        setStatus('reconnecting');
        if (source?.readyState === EventSource.CLOSED) {
          source = undefined;
          void checkSessionThenReopen();
        }
      });
    };

    const checkSessionThenReopen = async () => {
      try {
        await api('/auth/me', { authRedirect: false });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          notifyUnauthorized();
          return;
        }
        // Backend unreachable: keep retrying.
      }
      if (disposed) return;
      const delay = REOPEN_DELAYS_MS[Math.min(failures, REOPEN_DELAYS_MS.length - 1)];
      failures += 1;
      reopenTimer = setTimeout(open, delay);
    };

    open();
    return () => {
      disposed = true;
      clearTimeout(reopenTimer);
      source?.close();
    };
  }, [queryClient]);

  return status;
}
