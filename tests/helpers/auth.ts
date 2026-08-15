import type { FastifyInstance } from "fastify";
import prisma from "../../src/lib/prisma.js";
import { hashPassword } from "../../src/modules/auth/auth.password.js";
import { Permission } from "../../src/generated/prisma/index.js";

export type TestActor = { userId: string; headers: { authorization: string } };

export const ALL_PERMISSIONS = Object.values(Permission);

/** Cria um usuário com as permissões pedidas e devolve o cabeçalho pronto. */
export async function createActor(app: FastifyInstance, permissions: Permission[]): Promise<TestActor> {
  const user = await prisma.user.create({
    data: {
      name: "Test Actor",
      username: `actor-${crypto.randomUUID().slice(0, 8)}`,
      email: `actor-${crypto.randomUUID()}@example.test`,
      passwordHash: await hashPassword(`pwd-${crypto.randomUUID()}`),
      grantedPermissions: permissions,
    },
  });

  return { userId: user.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: user.id })}` } };
}

export async function deleteActor(userId: string): Promise<void> {
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
}
