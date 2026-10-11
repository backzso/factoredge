import { notifications } from '@mantine/notifications';
import { describeError } from '../api/errors';

export function notifyError(error: unknown): void {
  const { title, message } = describeError(error);
  notifications.show({ color: 'red', title, message, autoClose: 8_000 });
}

export function notifySuccess(message: string): void {
  notifications.show({ color: 'green', message });
}

/** Stays until dismissed: an alarm must not vanish while nobody looks. */
export function notifyAlarm(title: string, message: string): void {
  notifications.show({ color: 'red', title, message, autoClose: false });
}

export function notifyInfo(title: string, message: string): void {
  notifications.show({ color: 'blue', title, message, autoClose: 8_000 });
}
