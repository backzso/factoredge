import type { QueryClient } from '@tanstack/react-query';
import { endSession } from '../api/auth';
import { qk } from '../api/queryKeys';
import type { AuthUser, SessionEvent } from '../api/types';
import { notifyInfo } from '../components/notify';
import { ROLE_LABEL } from '../lib/labels';

export type SessionAction =
  /** Leave the app: clear the cache, show the notice, go to /login. */
  | { kind: 'end'; title: string; message: string }
  /** Reload ['me']; menus, buttons and RequireCan follow the new role. */
  | { kind: 'reload-me' };

export const SESSION_ENDED_TITLE = 'Oturumunuz sonlandırıldı';

/** What a session event from the live stream asks of the app. */
export function sessionAction(event: SessionEvent): SessionAction {
  switch (event.type) {
    case 'session-ended':
      return {
        kind: 'end',
        title: SESSION_ENDED_TITLE,
        message:
          event.data.reason === 'expired'
            ? 'Oturum süreniz doldu. Devam etmek için yeniden giriş yapın.'
            : 'Hesabınız bir yönetici tarafından kaldırıldı.',
      };
    case 'session-changed':
      return { kind: 'reload-me' };
  }
}

/** The notice to show when reloading the user revealed a new role, else null. */
export function roleChangeNotice(
  before: AuthUser | null | undefined,
  after: AuthUser | null | undefined,
): string | null {
  if (!before || !after || before.role === after.role) return null;
  return `Rolünüz ${ROLE_LABEL[before.role]} → ${ROLE_LABEL[after.role]} olarak değiştirildi.`;
}

/** Carries out a session event (thin glue over sessionAction). */
export async function applySessionEvent(
  queryClient: QueryClient,
  event: SessionEvent,
): Promise<void> {
  const action = sessionAction(event);
  if (action.kind === 'end') {
    endSession(queryClient);
    notifyInfo(action.title, action.message);
    return;
  }
  const before = queryClient.getQueryData<AuthUser | null>(qk.me);
  await queryClient.refetchQueries({ queryKey: qk.me, exact: true });
  const notice = roleChangeNotice(before, queryClient.getQueryData<AuthUser | null>(qk.me));
  if (notice) notifyInfo('Yetkileriniz değişti', notice);
}
