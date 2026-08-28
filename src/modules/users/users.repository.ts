import { Permission } from "../../generated/prisma/index.js";
import { prisma } from "../../lib/prisma.js";

const WITH_ROLE = { include: { role: true } } as const;

// Reading one user by id or by username already lives in auth.repository.ts. A second copy here
// would be a second place to fix the day the query changes, so this module owns only what the
// cadastro needs on top of it.
export function listUsers() {
  return prisma.user.findMany({ ...WITH_ROLE, orderBy: { name: "asc" } });
}

export function insertUser(input: {
  name: string;
  username: string;
  passwordHash: string;
  roleId?: string | null;
  extraPermissions?: Permission[];
}) {
  return prisma.user.create({ data: input, ...WITH_ROLE });
}

export function updateUser(
  id: string,
  input: { name?: string; roleId?: string | null; extraPermissions?: Permission[]; isActive?: boolean },
) {
  return prisma.user.update({ where: { id }, data: input, ...WITH_ROLE });
}
