import prisma from "../../lib/prisma.js";

export function findUserForAuthentication(username: string) {
  return prisma.user.findUnique({ where: { username } });
}

export function findActiveUserWithRole(id: string) {
  return prisma.user.findFirst({ where: { id, isActive: true }, include: { role: true } });
}

export function findRefreshToken(tokenHash: string) {
  return prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
}

export function createRefreshToken(userId: string, tokenHash: string, expiresAt: Date) {
  return prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
}

export function replaceRefreshToken(currentId: string, userId: string, tokenHash: string, expiresAt: Date) {
  return prisma.$transaction(async (tx) => {
    const next = await tx.refreshToken.create({ data: { userId, tokenHash, expiresAt } });

    await tx.refreshToken.update({
      where: { id: currentId },
      data: { revokedAt: new Date(), replacedById: next.id },
    });

    return next;
  });
}

export function revokeRefreshTokenByHash(tokenHash: string, userId: string) {
  return prisma.refreshToken.updateMany({
    where: { tokenHash, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function revokeAllRefreshTokens(userId: string) {
  return prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
