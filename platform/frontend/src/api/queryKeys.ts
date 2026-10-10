/** History window used by the history page and the live append. */
export const HISTORY_MINUTES = 60;

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
};
