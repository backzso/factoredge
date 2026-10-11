/** History window used by the history page and the live append. */
export const HISTORY_MINUTES = 60;

/** Size of the dashboard's "Son olaylar" list. */
export const RECENT_EVENTS_LIMIT = 8;

export const qk = {
  me: ['me'] as const,
  devices: ['devices'] as const,
  templates: ['templates'] as const,
  users: ['users'] as const,
  latest: ['latest'] as const,
  /** Prefix: every readings query. */
  allReadings: ['readings'] as const,
  /** Prefix: every readings query of one device. */
  deviceReadings: (deviceId: string) => ['readings', deviceId] as const,
  readings: (deviceId: string, minutes: number = HISTORY_MINUTES) =>
    ['readings', deviceId, minutes] as const,
  /** Prefix: every event log query. */
  allEvents: ['events'] as const,
  /** The events page, per device filter (pages of the infinite query). */
  events: (deviceId: string | null) => ['events', 'list', deviceId ?? 'all'] as const,
  /** The dashboard's short list. */
  recentEvents: ['events', 'recent'] as const,
};
