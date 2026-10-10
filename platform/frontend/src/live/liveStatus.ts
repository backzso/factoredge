import { createContext, useContext } from 'react';
import type { LiveStatus } from './useLiveStream';

/**
 * Status of the layout's live stream, for pages that show live data.
 * Outside the layout (login, tests) data is treated as current.
 */
export const LiveStatusContext = createContext<LiveStatus>('live');

export function useLiveStatus(): LiveStatus {
  return useContext(LiveStatusContext);
}

/**
 * True while the stream is down after having been up (or never came up within
 * the silence timeout): health and values on screen are the last known ones.
 * The short 'connecting' at start-up does not count; the data was just loaded
 * over REST and the snapshot follows within moments.
 */
export function useShowingLastKnown(): boolean {
  return useLiveStatus() === 'reconnecting';
}
