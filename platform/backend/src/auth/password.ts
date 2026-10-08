import { compare, hash } from 'bcryptjs';

// ~250 ms per hash on a laptop: slow enough for offline attacks, fine for interactive logins.
const BCRYPT_COST = 12;

export function hashPassword(password: string): Promise<string> {
  return hash(password, BCRYPT_COST);
}

export function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return compare(password, passwordHash);
}
