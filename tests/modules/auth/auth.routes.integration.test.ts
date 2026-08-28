import { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../../src/modules/auth/auth.password.js";
import { resetDatabase, testPrisma } from "../../support/database.js";
import { startTestApp } from "../../support/app.js";

const PASSWORD = "correct horse battery";

let app: FastifyInstance;

async function createUser() {
  const role = await testPrisma.role.create({ data: { name: "Seller", permissions: ["SALES_READ"] } });

  return testPrisma.user.create({
    data: {
      name: "Test Person",
      username: "tester",
      passwordHash: await hashPassword(PASSWORD),
      roleId: role.id,
      extraPermissions: ["REPORTS_READ"],
    },
  });
}

async function loginAs(username = "tester", password = PASSWORD) {
  const response = await app.inject({ method: "POST", url: "/sessions", payload: { username, password } });

  return { statusCode: response.statusCode, body: response.json() };
}

// A fresh application per case, not per file: the login rate limiter keeps its counters in the
// instance, and a budget shared between cases would make one test fail because of another.
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

describe("POST /sessions", () => {
  it("answers 200 and a token pair for the right credentials", async () => {
    await createUser();

    const { statusCode, body } = await loginAs();

    expect(statusCode).toBe(200);
    expect(typeof body.accessToken).toBe("string");
    expect(typeof body.refreshToken).toBe("string");
  });

  it("answers 401 with the same message for a wrong password and for an unknown username", async () => {
    await createUser();

    const wrongPassword = await loginAs("tester", "wrong");
    const unknownUser = await loginAs("ghost", PASSWORD);

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    expect(wrongPassword.body).toEqual(unknownUser.body);
  });

  it("answers 400 when the body does not carry a username", async () => {
    const response = await app.inject({ method: "POST", url: "/sessions", payload: { password: PASSWORD } });

    expect(response.statusCode).toBe(400);
  });
});

describe("POST /sessions/refresh", () => {
  it("answers a new pair", async () => {
    await createUser();
    const { body } = await loginAs();

    const response = await app.inject({
      method: "POST",
      url: "/sessions/refresh",
      payload: { refreshToken: body.refreshToken },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().refreshToken).not.toBe(body.refreshToken);
  });

  it("answers 401 for a token that was already rotated", async () => {
    await createUser();
    const { body } = await loginAs();
    await app.inject({ method: "POST", url: "/sessions/refresh", payload: { refreshToken: body.refreshToken } });

    const response = await app.inject({
      method: "POST",
      url: "/sessions/refresh",
      payload: { refreshToken: body.refreshToken },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("DELETE /sessions", () => {
  it("revokes the refresh token presented", async () => {
    await createUser();
    const { body } = await loginAs();

    const logout = await app.inject({
      method: "DELETE",
      url: "/sessions",
      headers: { authorization: `Bearer ${body.accessToken}` },
      payload: { refreshToken: body.refreshToken },
    });

    const refresh = await app.inject({
      method: "POST",
      url: "/sessions/refresh",
      payload: { refreshToken: body.refreshToken },
    });

    expect(logout.statusCode).toBe(204);
    expect(refresh.statusCode).toBe(401);
  });

  it("answers 401 without an access token", async () => {
    const response = await app.inject({ method: "DELETE", url: "/sessions", payload: { refreshToken: "whatever" } });

    expect(response.statusCode).toBe(401);
  });
});

describe("GET /me", () => {
  it("answers the current user and the permission the role and the extras add up to", async () => {
    const user = await createUser();
    const { body } = await loginAs();

    const response = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${body.accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: user.id,
      name: "Test Person",
      username: "tester",
      roleId: user.roleId,
      permissions: ["SALES_READ", "REPORTS_READ"],
    });
  });

  it("answers 401 once the user is deactivated, on the next request", async () => {
    const user = await createUser();
    const { body } = await loginAs();

    await testPrisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    const response = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${body.accessToken}` },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("GET /health", () => {
  it("answers without a token", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });
});
