import prisma from "../../lib/prisma.js";
import { hashPassword } from "../auth/auth.password.js";
import type { CreateUserInput, UpdateUserInput } from "./users.schema.js";

/** Tudo menos o hash da senha: nenhuma rota devolve credencial. */
const publicFields = {
  id: true,
  name: true,
  username: true,
  email: true,
  roleId: true,
  grantedPermissions: true,
  deniedPermissions: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function listUsers() {
  return prisma.user.findMany({ select: publicFields, orderBy: { name: "asc" } });
}

export function getUser(id: string) {
  return prisma.user.findUnique({ where: { id }, select: publicFields });
}

export function getUserWithRole(id: string) {
  return prisma.user.findUnique({ where: { id }, select: { ...publicFields, role: true } });
}

export async function createUser(data: CreateUserInput) {
  const { password, ...rest } = data;

  return prisma.user.create({
    data: { ...rest, passwordHash: await hashPassword(password) },
    select: publicFields,
  });
}

export function updateUser(id: string, data: UpdateUserInput) {
  return prisma.user.update({ where: { id }, data, select: publicFields });
}
