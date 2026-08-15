import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import prisma from "../../src/lib/prisma.js";
import { verifyPassword } from "../../src/modules/auth/auth.password.js";
import { Permission } from "../../src/generated/prisma/index.js";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const OWNER_EMAIL = `owner-seed-${crypto.randomUUID()}@example.test`;
const OWNER_PASSWORD = "senha-do-dono";

function runSeed() {
  execFileSync("npm", ["run", "db:seed"], {
    cwd: projectRoot,
    stdio: "pipe",
    env: { ...process.env, OWNER_EMAIL, OWNER_PASSWORD },
  });
}

describe("db:seed", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: OWNER_EMAIL } });
    await prisma.role.deleteMany({ where: { name: "Owner", users: { none: {} } } });
    await prisma.$disconnect();
  });

  test("cria o papel Owner com as 13 permissões e o primeiro usuário", async () => {
    runSeed();

    const [role, user] = await Promise.all([
      prisma.role.findUnique({ where: { name: "Owner" } }),
      prisma.user.findUnique({ where: { email: OWNER_EMAIL } }),
    ]);

    expect(role?.permissions.sort()).toEqual(Object.values(Permission).sort());
    expect(user?.roleId).toBe(role?.id);
    expect(await verifyPassword(OWNER_PASSWORD, user!.passwordHash)).toBe(true);
  }, 120_000);

  test("rodar de novo não duplica nem quebra", async () => {
    runSeed();

    expect(await prisma.user.count({ where: { email: OWNER_EMAIL } })).toBe(1);
    expect(await prisma.role.count({ where: { name: "Owner" } })).toBe(1);
  }, 120_000);
});
