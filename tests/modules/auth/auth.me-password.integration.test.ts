import { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyPassword } from "../../../src/modules/auth/auth.password.js";
import { authenticateAs, startTestApp } from "../../support/app.js";
import { resetDatabase, testPrisma } from "../../support/database.js";

const CURRENT = "correct horse battery";
const NEXT = "an-even-better-password";

let app: FastifyInstance;

// A fresh application per case, not per file: the login rate limiter keeps its counters in the
// instance, and authenticateAs signs in with the same username in every case.
beforeEach(async () => {
  app = await startTestApp();
});

afterEach(async () => {
  await app.close();
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("PATCH /v1/sessions/me/password", () => {
  it("replaces the password and ends every session, including the one that asked", async () => {
    const { userId, headers } = await authenticateAs(app, []);

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/sessions/me/password",
      headers,
      payload: { currentPassword: CURRENT, newPassword: NEXT },
    });

    const stored = await testPrisma.user.findUnique({ where: { id: userId } });
    const survivors = await testPrisma.refreshToken.count({ where: { userId, revokedAt: null } });

    expect(response.statusCode).toBe(204);
    expect(await verifyPassword(NEXT, stored!.passwordHash)).toBe(true);
    expect(survivors).toBe(0);
  });

  it("answers 401 when the current password is wrong, and keeps the old one", async () => {
    const { userId, headers } = await authenticateAs(app, []);

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/sessions/me/password",
      headers,
      payload: { currentPassword: "not-my-password", newPassword: NEXT },
    });

    const stored = await testPrisma.user.findUnique({ where: { id: userId } });

    expect(response.statusCode).toBe(401);
    expect(await verifyPassword(CURRENT, stored!.passwordHash)).toBe(true);
  });

  it("answers 400 for a new password shorter than eight characters", async () => {
    const { headers } = await authenticateAs(app, []);

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/sessions/me/password",
      headers,
      payload: { currentPassword: CURRENT, newPassword: "short" },
    });

    expect(response.statusCode).toBe(400);
  });
});
