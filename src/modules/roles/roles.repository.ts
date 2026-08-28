import { Permission } from "../../generated/prisma/index.js";
import { prisma } from "../../lib/prisma.js";

export function listRoles() {
  return prisma.role.findMany({ orderBy: { name: "asc" } });
}

export function findRoleById(id: string) {
  return prisma.role.findUnique({ where: { id } });
}

export function findRoleByName(name: string) {
  return prisma.role.findUnique({ where: { name } });
}

export function insertRole(input: { name: string; permissions: Permission[] }) {
  return prisma.role.create({ data: input });
}

export function updateRole(id: string, input: { name?: string; permissions?: Permission[] }) {
  return prisma.role.update({ where: { id }, data: input });
}

export async function deleteRole(id: string): Promise<void> {
  await prisma.role.delete({ where: { id } });
}
