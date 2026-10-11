import { describe, expect, it } from 'vitest';
import { can } from './auth';
import type { AuthUser, Role } from './types';

const user = (role: Role): AuthUser => ({ id: role, username: role.toLowerCase(), role });

describe('can', () => {
  it.each([
    ['ADMIN', true, true],
    ['ENGINEER', true, false],
    ['VIEWER', false, false],
  ] as const)('%s: manageDevices %s, manageUsers %s', (role, devices, users) => {
    expect(can(user(role), 'manageDevices')).toBe(devices);
    expect(can(user(role), 'manageUsers')).toBe(users);
  });

  it('allows nothing without a user', () => {
    expect(can(null, 'manageDevices')).toBe(false);
    expect(can(undefined, 'manageUsers')).toBe(false);
  });
});
