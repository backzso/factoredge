import type { QueryClient } from '@tanstack/react-query';
import { endSession } from './auth';
import { qk } from './queryKeys';
import type { AuthUser } from './types';

/**
 * Logins and logouts are told to the other tabs of this browser. They share the
 * auth cookie, so a logout in one tab ends the session in all of them, and a
 * login in one is a login in all of them.
 */
export type SessionMessage =
  | { type: 'logout'; userId: string | null }
  | { type: 'login'; userId: string };

export const SESSION_CHANNEL = 'factoredge-session';

type ChannelFactory = (name: string) => BroadcastChannel | undefined;

const browserChannel: ChannelFactory = (name) =>
  typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(name);

// One channel per tab, used for sending and receiving: a channel does not get
// its own messages, but a second one in the same tab would.
let channel: BroadcastChannel | undefined;

/** Starts listening for the other tabs; returns a function that stops it. */
export function startSessionSync(
  queryClient: QueryClient,
  createChannel: ChannelFactory = browserChannel,
): () => void {
  const own = createChannel(SESSION_CHANNEL);
  if (!own) return () => {};
  channel = own;
  own.onmessage = (event: MessageEvent<SessionMessage>) =>
    applySessionMessage(queryClient, event.data);
  return () => {
    own.close();
    if (channel === own) channel = undefined;
  };
}

/** Tells the other tabs; a no-op without BroadcastChannel. */
export function announceSession(message: SessionMessage): void {
  channel?.postMessage(message);
}

/** What a tab does when another tab logged in or out. */
export function applySessionMessage(queryClient: QueryClient, message: SessionMessage): void {
  const current = queryClient.getQueryData<AuthUser | null>(qk.me);
  switch (message.type) {
    case 'logout':
      // Already logged out, or since logged in as someone else.
      if (current === null) return;
      if (current && message.userId && current.id !== message.userId) return;
      // Clears the cache; RequireAuth sends the tab to /login, which unmounts
      // the layout and closes its live stream.
      endSession(queryClient);
      return;
    case 'login':
      if (current?.id === message.userId) return;
      // Another user's data must not stay on screen.
      if (current) endSession(queryClient);
      void queryClient.refetchQueries({ queryKey: qk.me, exact: true });
      return;
  }
}
