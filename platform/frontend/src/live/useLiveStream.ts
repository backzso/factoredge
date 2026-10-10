import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiError, notifyUnauthorized } from '../api/client';
import { type LiveEvent, LIVE_EVENT_TYPES } from '../api/types';
import { backoffDelay } from '../lib/backoff';
import { applyLiveEvent } from './applyLiveEvent';
import {
  checkSilence,
  recordActivity,
  SILENCE_TIMEOUT_MS,
  type SilenceWatch,
  startWatch,
} from './silenceWatchdog';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting';

/**
 * The one EventSource of the app, mounted by the layout while logged in.
 *
 * - The browser reconnects by itself after a dropped connection
 *   (readyState CONNECTING); the snapshot sent on every (re)connect repairs the cache.
 * - The stream is given up and reopened by us when
 *   - the browser closed it for good (readyState CLOSED: a non-200 answer such
 *     as 401, or the dev proxy's 502 while the backend is down), or
 *   - it went silent: no event, heartbeat included, for 15 s. A proxy can keep
 *     the connection open after the backend died, without any error.
 *   /auth/me then tells whether the session ended (the 401 handler sends the
 *   user to the login page); otherwise the stream is reopened with a growing delay.
 */
export function useLiveStream(): LiveStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('connecting');

  useEffect(() => {
    let source: EventSource | undefined;
    let watch: SilenceWatch | undefined;
    let silenceTimer: ReturnType<typeof setTimeout> | undefined;
    let reopenTimer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let disposed = false;

    const markActivity = () => {
      if (watch) watch = recordActivity(watch, Date.now());
    };

    const armSilenceTimer = (delayMs: number) => {
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        if (!watch) return;
        const check = checkSilence(watch, Date.now());
        if (check.silent) {
          giveUp();
        } else {
          armSilenceTimer(check.checkAgainInMs);
        }
      }, delayMs);
    };

    const handleEvent = (type: LiveEvent['type']) => (message: MessageEvent<string>) => {
      markActivity();
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
      const es = new EventSource('/api/stream');
      source = es;
      watch = startWatch(Date.now());
      armSilenceTimer(SILENCE_TIMEOUT_MS);

      es.addEventListener('open', () => {
        failures = 0;
        markActivity();
        setStatus('live');
      });
      for (const type of LIVE_EVENT_TYPES) {
        es.addEventListener(type, handleEvent(type));
      }
      es.addEventListener('error', () => {
        if (disposed || es !== source) return;
        setStatus('reconnecting');
        if (es.readyState === EventSource.CLOSED) {
          giveUp();
        }
        // readyState CONNECTING: the browser retries on its own; the silence
        // timer still covers a retry that never gets anywhere.
      });
    };

    /** Drops the current stream and reopens it after a session check and a backoff delay. */
    const giveUp = () => {
      clearTimeout(silenceTimer);
      watch = undefined;
      source?.close();
      source = undefined;
      setStatus('reconnecting');
      void checkSessionThenReopen();
    };

    const checkSessionThenReopen = async () => {
      try {
        await api('/auth/me', { authRedirect: false });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          notifyUnauthorized();
          return;
        }
        // Backend unreachable (network error, 502…): keep retrying.
      }
      if (disposed) return;
      reopenTimer = setTimeout(open, backoffDelay(failures));
      failures += 1;
    };

    open();
    return () => {
      disposed = true;
      clearTimeout(silenceTimer);
      clearTimeout(reopenTimer);
      source?.close();
    };
  }, [queryClient]);

  return status;
}
