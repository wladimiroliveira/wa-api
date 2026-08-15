import { loadAuthConfig } from "./auth.config.js";
import { hashPassword, verifyPassword } from "./auth.password.js";
import { generateRefreshToken, hashRefreshToken } from "./auth.tokens.js";
import * as repo from "./auth.repository.js";

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Email ou senha inválidos");
  }
}

export class InvalidRefreshTokenError extends Error {
  constructor() {
    super("Refresh token inválido ou expirado");
  }
}

/** Hash descartável: mantém o custo do login parecido quando o email não existe. */
const decoyHash = await hashPassword(generateRefreshToken());

export async function authenticate(email: string, password: string): Promise<{ id: string }> {
  const user = await repo.findUserForAuthentication(email);

  if (!user || !user.isActive) {
    await verifyPassword(password, decoyHash);
    throw new InvalidCredentialsError();
  }

  if (!(await verifyPassword(password, user.passwordHash))) throw new InvalidCredentialsError();

  return { id: user.id };
}

function expiryFromNow(): Date {
  const { refreshTokenTtlDays } = loadAuthConfig();

  return new Date(Date.now() + refreshTokenTtlDays * 24 * 60 * 60 * 1000);
}

export async function issueRefreshToken(userId: string): Promise<string> {
  const token = generateRefreshToken();
  await repo.createRefreshToken(userId, hashRefreshToken(token), expiryFromNow());

  return token;
}

export async function rotateRefreshToken(token: string): Promise<{ userId: string; refreshToken: string }> {
  const stored = await repo.findRefreshToken(hashRefreshToken(token));

  if (!stored) throw new InvalidRefreshTokenError();

  // Token já rotacionado ou revogado sendo reapresentado: trata como roubo.
  if (stored.revokedAt) {
    await repo.revokeAllRefreshTokens(stored.userId);
    throw new InvalidRefreshTokenError();
  }

  if (stored.expiresAt <= new Date() || !stored.user.isActive) throw new InvalidRefreshTokenError();

  const next = generateRefreshToken();
  await repo.replaceRefreshToken(stored.id, stored.userId, hashRefreshToken(next), expiryFromNow());

  return { userId: stored.userId, refreshToken: next };
}

export async function revokeRefreshToken(token: string, userId: string): Promise<void> {
  await repo.revokeRefreshTokenByHash(hashRefreshToken(token), userId);
}
