import { prisma } from "../../lib/prisma.js";
import { AuthenticatedUser } from "./auth.access.js";
import { effectivePermissions } from "./auth.permissions.js";

export function findUserByUsername(username: string) {
  return prisma.user.findUnique({ where: { username }, include: { role: true } });
}

export function findUserById(id: string) {
  return prisma.user.findUnique({ where: { id }, include: { role: true } });
}

// The one query that crosses user and role. It answers an authentication question, which is why it
// lives here and not in the users module.
export async function loadAuthenticatedUser(userId: string): Promise<AuthenticatedUser | null> {
  const user = await findUserById(userId);

  if (user === null || !user.isActive) return null;

  return {
    id: user.id,
    permissions: effectivePermissions({
      rolePermissions: user.role?.permissions ?? [],
      extraPermissions: user.extraPermissions,
    }),
  };
}

export function insertRefreshToken(input: { userId: string; tokenHash: string; expiresAt: Date }) {
  return prisma.refreshToken.create({ data: input });
}

export function findRefreshTokenByHash(tokenHash: string) {
  return prisma.refreshToken.findUnique({ where: { tokenHash } });
}

export async function markRefreshTokenReplaced(id: string, replacedById: string): Promise<void> {
  await prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date(), replacedById } });
}

export async function revokeRefreshToken(id: string): Promise<void> {
  await prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
