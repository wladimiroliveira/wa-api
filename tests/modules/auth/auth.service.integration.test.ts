import fastify, { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerAccessToken, verifyAccessToken } from "../../../src/modules/auth/auth.jwt.js";
import { hashPassword } from "../../../src/modules/auth/auth.password.js";
import { hashRefreshToken } from "../../../src/modules/auth/auth.refresh-token.js";
import { login, logout, refreshSession } from "../../../src/modules/auth/auth.service.js";
import { loadAuthenticatedUser, revokeAllRefreshTokens } from "../../../src/modules/auth/auth.repository.js";
import { resetDatabase, testPrisma } from "../../support/database.js";

const SECRET = "a-secret-long-enough-to-be-taken-seriously";
const PASSWORD = "correct horse battery";

let app: FastifyInstance;

async function createUser(overrides: { isActive?: boolean } = {}) {
  return testPrisma.user.create({
    data: {
      name: "Test Person",
      username: "tester",
      passwordHash: await hashPassword(PASSWORD),
      isActive: overrides.isActive ?? true,
    },
  });
}

beforeEach(async () => {
  app = fastify();
  await registerAccessToken(app, { secret: SECRET, ttlMinutes: 15 });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("login", () => {
  it("answers a token pair for the right credentials", async () => {
    const user = await createUser();

    const tokens = await login(app, { username: "tester", password: PASSWORD });

    expect(tokens).not.toBeNull();
    expect(verifyAccessToken(app, tokens!.accessToken)?.sub).toBe(user.id);
  });

  it("stores only the hash of the refresh token", async () => {
    await createUser();

    const tokens = await login(app, { username: "tester", password: PASSWORD });
    const stored = await testPrisma.refreshToken.findMany();

    expect(stored).toHaveLength(1);
    expect(stored[0].tokenHash).toBe(hashRefreshToken(tokens!.refreshToken));
    expect(stored[0].tokenHash).not.toBe(tokens!.refreshToken);
  });

  it("answers null for the wrong password", async () => {
    await createUser();

    expect(await login(app, { username: "tester", password: "wrong" })).toBeNull();
  });

  it("answers null for a username nobody has", async () => {
    expect(await login(app, { username: "ghost", password: PASSWORD })).toBeNull();
  });

  it("answers null for a deactivated user", async () => {
    await createUser({ isActive: false });

    expect(await login(app, { username: "tester", password: PASSWORD })).toBeNull();
  });
});

describe("refreshSession", () => {
  it("answers a new pair and revokes the one presented", async () => {
    await createUser();
    const first = await login(app, { username: "tester", password: PASSWORD });

    const second = await refreshSession(app, first!.refreshToken);

    expect(second).not.toBeNull();
    expect(second!.refreshToken).not.toBe(first!.refreshToken);

    const previous = await testPrisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(first!.refreshToken) },
    });

    expect(previous?.revokedAt).not.toBeNull();
    expect(previous?.replacedById).not.toBeNull();
  });

  it("revokes the whole chain when a rotated token comes back", async () => {
    await createUser();
    const first = await login(app, { username: "tester", password: PASSWORD });
    const second = await refreshSession(app, first!.refreshToken);

    expect(await refreshSession(app, first!.refreshToken)).toBeNull();

    const survivors = await testPrisma.refreshToken.findMany({ where: { revokedAt: null } });

    expect(survivors).toHaveLength(0);
    expect(await refreshSession(app, second!.refreshToken)).toBeNull();
  });

  it("answers null for a refresh token nobody issued", async () => {
    expect(await refreshSession(app, "a-token-that-was-never-issued")).toBeNull();
  });

  it("answers null for an expired refresh token", async () => {
    const user = await createUser();
    const tokens = await login(app, { username: "tester", password: PASSWORD });

    await testPrisma.refreshToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date("2020-01-01T00:00:00.000Z") },
    });

    expect(await refreshSession(app, tokens!.refreshToken)).toBeNull();
  });
});

describe("logout", () => {
  it("revokes the token presented", async () => {
    await createUser();
    const tokens = await login(app, { username: "tester", password: PASSWORD });

    await logout(tokens!.refreshToken);

    expect(await refreshSession(app, tokens!.refreshToken)).toBeNull();
  });
});

describe("loadAuthenticatedUser", () => {
  it("answers the effective permission of an active user", async () => {
    const role = await testPrisma.role.create({ data: { name: "Seller", permissions: ["SALES_READ"] } });
    const user = await testPrisma.user.create({
      data: {
        name: "Test Person",
        username: "seller",
        passwordHash: await hashPassword(PASSWORD),
        roleId: role.id,
        extraPermissions: ["REPORTS_READ"],
      },
    });

    const authenticated = await loadAuthenticatedUser(user.id);

    expect(authenticated?.permissions.sort()).toEqual(["REPORTS_READ", "SALES_READ"]);
  });

  it("answers null for a deactivated user", async () => {
    const user = await createUser({ isActive: false });

    expect(await loadAuthenticatedUser(user.id)).toBeNull();
  });
});

describe("revokeAllRefreshTokens", () => {
  it("ends every session the user had", async () => {
    const user = await createUser();
    const tokens = await login(app, { username: "tester", password: PASSWORD });

    await revokeAllRefreshTokens(user.id);

    expect(await refreshSession(app, tokens!.refreshToken)).toBeNull();
  });
});
