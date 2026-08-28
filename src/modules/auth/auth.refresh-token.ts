import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

// SHA-256 is enough here, and scrypt would be wrong: the secret is 32 random bytes, not a password.
// There is no dictionary to slow down, and the database must never hold the token itself.
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function createRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");

  return { token, tokenHash: hashRefreshToken(token) };
}

export function refreshTokenExpiration(now: Date, ttlDays: number): Date {
  return new Date(now.getTime() + ttlDays * MILLISECONDS_PER_DAY);
}
