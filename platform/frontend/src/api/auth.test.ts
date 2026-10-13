import { describe, expect, it } from 'vitest';
import { can } from './auth';
import type { AuthUser, Role } from './types';

const user = (role: Role): AuthUser => ({ id: role, username: role.toLowerCase(), role });

describe('can', () => {
  it.each([
    ['ADMIN', true, true, true],
    ['ENGINEER', true, false, false],
    ['VIEWER', false, false, false],
  ] as const)(
    '%s: manageDevices %s, deleteDevices %s, manageUsers %s',
    (role, devices, deleteDevices, users) => {
      expect(can(user(role), 'manageDevices')).toBe(devices);
      expect(can(user(role), 'deleteDevices')).toBe(deleteDevices);
      expect(can(user(role), 'manageUsers')).toBe(users);
    },
  );

  it('allows nothing without a user', () => {
    expect(can(null, 'manageDevices')).toBe(false);
    expect(can(null, 'deleteDevices')).toBe(false);
    expect(can(undefined, 'manageUsers')).toBe(false);
  });
});
