import { FastifyInstance } from "fastify";
import { loadEnv } from "../../lib/env.js";
import { signAccessToken } from "./auth.jwt.js";
import { verifyPassword } from "./auth.password.js";
import { createRefreshToken, hashRefreshToken, refreshTokenExpiration } from "./auth.refresh-token.js";
import {
  findRefreshTokenByHash,
  findUserByUsername,
  insertRefreshToken,
  markRefreshTokenReplaced,
  revokeAllRefreshTokens,
  revokeRefreshToken,
} from "./auth.repository.js";

export type SessionTokens = { accessToken: string; refreshToken: string };

async function issueTokens(app: FastifyInstance, userId: string): Promise<SessionTokens & { refreshTokenId: string }> {
  const env = loadEnv();
  const { token, tokenHash } = createRefreshToken();

  const stored = await insertRefreshToken({
    userId,
    tokenHash,
    expiresAt: refreshTokenExpiration(new Date(), env.REFRESH_TOKEN_TTL_DAYS),
  });

  return { accessToken: signAccessToken(app, userId), refreshToken: token, refreshTokenId: stored.id };
}

export async function login(
  app: FastifyInstance,
  input: { username: string; password: string },
): Promise<SessionTokens | null> {
  const user = await findUserByUsername(input.username);

  // The password is verified even when the user does not exist, so that a missing username and a
  // wrong password take the same time to answer.
  const digest = user?.passwordHash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAA";
  const matches = await verifyPassword(input.password, digest);

  if (user === null || !user.isActive || !matches) return null;

  const { accessToken, refreshToken } = await issueTokens(app, user.id);

  return { accessToken, refreshToken };
}

export async function refreshSession(app: FastifyInstance, refreshToken: string): Promise<SessionTokens | null> {
  const stored = await findRefreshTokenByHash(hashRefreshToken(refreshToken));

  if (stored === null) return null;

  // A token that was already rotated coming back means two parties hold the same credential. The
  // safe reading is theft, so the whole chain goes down.
  if (stored.revokedAt !== null) {
    await revokeAllRefreshTokens(stored.userId);
    return null;
  }

  if (stored.expiresAt.getTime() <= Date.now()) return null;

  const issued = await issueTokens(app, stored.userId);

  await markRefreshTokenReplaced(stored.id, issued.refreshTokenId);

  return { accessToken: issued.accessToken, refreshToken: issued.refreshToken };
}

export async function logout(refreshToken: string): Promise<void> {
  const stored = await findRefreshTokenByHash(hashRefreshToken(refreshToken));

  if (stored === null || stored.revokedAt !== null) return;

  await revokeRefreshToken(stored.id);
}
