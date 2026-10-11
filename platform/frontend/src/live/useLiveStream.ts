import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiError, notifyUnauthorized } from '../api/client';
import { type LiveEvent, LIVE_EVENT_TYPES, type SessionEvent, SESSION_EVENT_TYPES } from '../api/types';
import { backoffDelay } from '../lib/backoff';
import { applyLiveEvent } from './applyLiveEvent';
import { applySessionEvent } from './sessionEvents';
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
 * - Session events concern this user only. session-ended (user deleted, token
 *   expired) closes the stream for good before the browser can reconnect and
 *   ends the session; session-changed (role, password) reloads ['me'].
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

    const parse = (type: string, message: MessageEvent<string>): unknown => {
      try {
        return JSON.parse(message.data);
      } catch {
        console.warn(`live: unparsable ${type} event`, message.data);
        return undefined;
      }
    };

    const handleEvent = (type: LiveEvent['type']) => (message: MessageEvent<string>) => {
      markActivity();
      const data = parse(type, message);
      if (data === undefined) return;
      applyLiveEvent(queryClient, { type, data } as LiveEvent, Date.now());
    };

    const handleSessionEvent = (type: SessionEvent['type']) => (message: MessageEvent<string>) => {
      markActivity();
      if (type === 'session-ended') {
        // The server ends the response next; the browser must not reconnect.
        stop();
      }
      // Acted on even if the payload is unreadable: the type says enough.
      const data = parse(type, message) ?? {};
      void applySessionEvent(queryClient, { type, data } as SessionEvent);
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
      for (const type of SESSION_EVENT_TYPES) {
        es.addEventListener(type, handleSessionEvent(type));
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

    /** Closes the stream for good. */
    const stop = () => {
      disposed = true;
      clearTimeout(silenceTimer);
      clearTimeout(reopenTimer);
      source?.close();
      source = undefined;
    };

    open();
    return stop;
  }, [queryClient]);

  return status;
}
