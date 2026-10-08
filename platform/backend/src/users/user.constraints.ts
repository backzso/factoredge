/** Shared by the DTOs and the seed script so both enforce the same rules. */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/;
export const USERNAME_RULE =
  'username must be 3-32 characters of letters, digits, "_", "." or "-"';

export const PASSWORD_MIN_BYTES = 8;
// bcrypt only uses the first 72 bytes; longer passwords are rejected instead of silently truncated.
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_RULE = `password must be ${PASSWORD_MIN_BYTES}-${PASSWORD_MAX_BYTES} bytes long`;

export function isValidPassword(password: string): boolean {
  const bytes = Buffer.byteLength(password, 'utf8');
  return bytes >= PASSWORD_MIN_BYTES && bytes <= PASSWORD_MAX_BYTES;
}
