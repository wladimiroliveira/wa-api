import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Permission } from "../../src/generated/prisma/index.js";
import { verifyPassword } from "../../src/modules/auth/auth.password.js";
import { seed } from "../../prisma/seed.js";
import { resetDatabase, testPrisma } from "../support/database.js";

const INPUT = { username: "owner", password: "the-owner-password" };

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("seed", () => {
  it("creates the Owner role holding every permission", async () => {
    await seed(testPrisma, INPUT);

    const role = await testPrisma.role.findUnique({ where: { name: "Owner" } });

    expect(role?.permissions.sort()).toEqual(Object.values(Permission).sort());
  });

  it("creates the first user with that role and the given password", async () => {
    await seed(testPrisma, INPUT);

    const user = await testPrisma.user.findUnique({ where: { username: "owner" }, include: { role: true } });

    expect(user?.role?.name).toBe("Owner");
    expect(await verifyPassword(INPUT.password, user!.passwordHash)).toBe(true);
  });

  it("does not duplicate anything when it runs twice", async () => {
    await seed(testPrisma, INPUT);
    await seed(testPrisma, INPUT);

    expect(await testPrisma.role.count()).toBe(1);
    expect(await testPrisma.user.count()).toBe(1);
  });

  it("does not overwrite a password that was already changed", async () => {
    await seed(testPrisma, INPUT);
    await testPrisma.user.update({ where: { username: "owner" }, data: { passwordHash: "already-changed" } });

    await seed(testPrisma, INPUT);

    const user = await testPrisma.user.findUnique({ where: { username: "owner" } });

    expect(user?.passwordHash).toBe("already-changed");
  });
});
