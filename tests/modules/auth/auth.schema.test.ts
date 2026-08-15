import { afterAll, describe, expect, test } from "vitest";
import prisma from "../../../src/lib/prisma.js";
import { Permission } from "../../../src/generated/prisma/index.js";

describe("auth schema", () => {
  const createdRoleIds: string[] = [];
  const createdUserIds: string[] = [];

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
    await prisma.$disconnect();
  });

  test("o enum Permission tem as 13 permissões de módulo", () => {
    expect(Object.values(Permission).sort()).toEqual(
      [
        "PRICING_READ",
        "PRODUCTION_READ",
        "PRODUCTION_WRITE",
        "RECIPES_READ",
        "RECIPES_WRITE",
        "STOCK_READ",
        "STOCK_WRITE",
        "SUPPLIES_READ",
        "SUPPLIES_WRITE",
        "USERS_READ",
        "USERS_WRITE",
        "WASTE_READ",
        "WASTE_WRITE",
      ].sort(),
    );
  });

  test("papel guarda uma lista de permissões e usuário herda dele", async () => {
    const role = await prisma.role.create({
      data: { name: `Stock Keeper ${Date.now()}`, permissions: [Permission.STOCK_READ, Permission.STOCK_WRITE] },
    });
    createdRoleIds.push(role.id);

    const user = await prisma.user.create({
      data: {
        name: "Keeper",
        email: `keeper-${Date.now()}@example.test`,
        passwordHash: "scrypt:deadbeef:deadbeef",
        roleId: role.id,
        grantedPermissions: [Permission.PRICING_READ],
        deniedPermissions: [Permission.STOCK_WRITE],
      },
      include: { role: true },
    });
    createdUserIds.push(user.id);

    expect(user.role?.permissions).toEqual([Permission.STOCK_READ, Permission.STOCK_WRITE]);
    expect(user.grantedPermissions).toEqual([Permission.PRICING_READ]);
    expect(user.deniedPermissions).toEqual([Permission.STOCK_WRITE]);
    expect(user.isActive).toBe(true);
  });

  test("apagar o usuário leva junto os refresh tokens dele", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Ephemeral",
        email: `ephemeral-${Date.now()}@example.test`,
        passwordHash: "scrypt:deadbeef:deadbeef",
      },
    });

    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: `hash-${Date.now()}`, expiresAt: new Date(Date.now() + 60_000) },
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });
});
