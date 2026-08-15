import prisma from "../../lib/prisma.js";
import type { CreateRoleInput, UpdateRoleInput } from "./roles.schema.js";

export function listRoles() {
  return prisma.role.findMany({ orderBy: { name: "asc" } });
}

export function createRole(data: CreateRoleInput) {
  return prisma.role.create({ data });
}

export function updateRole(id: string, data: UpdateRoleInput) {
  return prisma.role.update({ where: { id }, data });
}

export function deleteRole(id: string) {
  return prisma.role.delete({ where: { id } });
}
