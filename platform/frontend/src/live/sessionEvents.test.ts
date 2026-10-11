import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../api/types';
import { roleChangeNotice, SESSION_ENDED_TITLE, sessionAction } from './sessionEvents';

const admin: AuthUser = { id: 'u1', username: 'ayse', role: 'ADMIN' };
const viewer: AuthUser = { ...admin, role: 'VIEWER' };

describe('sessionAction', () => {
  it('session-ended (deleted) ends the session with the notice', () => {
    expect(sessionAction({ type: 'session-ended', data: { reason: 'deleted' } })).toEqual({
      kind: 'end',
      title: SESSION_ENDED_TITLE,
      message: 'Hesabınız bir yönetici tarafından kaldırıldı.',
    });
  });

  it('session-ended (expired) ends the session and says the time ran out', () => {
    const action = sessionAction({ type: 'session-ended', data: { reason: 'expired' } });
    expect(action.kind).toBe('end');
    expect(action).toMatchObject({ title: 'Oturumunuz sonlandırıldı' });
    expect(action.kind === 'end' && action.message).toContain('süreniz doldu');
  });

  it('session-changed reloads the user, whatever changed', () => {
    for (const changes of [['role'], ['password'], ['role', 'password']] as const) {
      expect(sessionAction({ type: 'session-changed', data: { changes: [...changes] } })).toEqual({
        kind: 'reload-me',
      });
    }
  });
});

describe('roleChangeNotice', () => {
  it('names the old and the new role', () => {
    expect(roleChangeNotice(admin, viewer)).toBe('Rolünüz Yönetici → İzleyici olarak değiştirildi.');
    expect(roleChangeNotice(viewer, { ...viewer, role: 'ENGINEER' })).toBe(
      'Rolünüz İzleyici → Mühendis olarak değiştirildi.',
    );
  });

  it('is silent when the role stayed (password change) or the user is gone', () => {
    expect(roleChangeNotice(admin, admin)).toBeNull();
    expect(roleChangeNotice(admin, null)).toBeNull();
    expect(roleChangeNotice(undefined, viewer)).toBeNull();
  });
});
