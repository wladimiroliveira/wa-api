import { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Permission } from "../../../src/generated/prisma/index.js";
import { authenticateAs, startTestApp } from "../../support/app.js";
import { resetDatabase, testPrisma } from "../../support/database.js";

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

describe("POST /v1/users", () => {
  it("creates a user and never answers the password back", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_CREATE], "admin");

    const response = await app.inject({
      method: "POST",
      url: "/v1/users",
      headers,
      payload: { name: "New Person", username: "newbie", password: "a-good-password" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: "New Person", username: "newbie", permissions: [] });
    expect(JSON.stringify(response.json())).not.toContain("a-good-password");
    expect(JSON.stringify(response.json())).not.toContain("passwordHash");
  });

  it("stores the password hashed", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_CREATE], "admin");

    await app.inject({
      method: "POST",
      url: "/v1/users",
      headers,
      payload: { name: "New Person", username: "newbie", password: "a-good-password" },
    });

    const stored = await testPrisma.user.findUnique({ where: { username: "newbie" } });

    expect(stored?.passwordHash).toMatch(/^scrypt\$/);
  });

  it("answers 409 for a username somebody already has", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_CREATE], "admin");

    const response = await app.inject({
      method: "POST",
      url: "/v1/users",
      headers,
      payload: { name: "Impostor", username: "admin", password: "a-good-password" },
    });

    expect(response.statusCode).toBe(409);
  });

  it("answers 400 for a password shorter than eight characters", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_CREATE], "admin");

    const response = await app.inject({
      method: "POST",
      url: "/v1/users",
      headers,
      payload: { name: "New Person", username: "newbie", password: "short" },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("GET /v1/users/:id", () => {
  it("answers the effective permission alongside the record", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_READ], "admin");
    const role = await testPrisma.role.create({ data: { name: "Seller", permissions: ["SALES_READ"] } });
    const user = await testPrisma.user.create({
      data: {
        name: "Someone",
        username: "someone",
        passwordHash: "x",
        roleId: role.id,
        extraPermissions: ["REPORTS_READ"],
      },
    });

    const response = await app.inject({ method: "GET", url: `/v1/users/${user.id}`, headers });

    expect(response.statusCode).toBe(200);
    expect(response.json().permissions.sort()).toEqual(["REPORTS_READ", "SALES_READ"]);
  });

  it("answers 404 for a user that does not exist", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_READ], "admin");

    const response = await app.inject({
      method: "GET",
      url: "/v1/users/0199a1f0-0000-7000-8000-0000000000ff",
      headers,
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("PATCH /v1/users/:id", () => {
  it("assigns a role", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_UPDATE], "admin");
    const role = await testPrisma.role.create({ data: { name: "Seller", permissions: ["SALES_READ"] } });
    const user = await testPrisma.user.create({
      data: { name: "Someone", username: "someone", passwordHash: "x" },
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/users/${user.id}`,
      headers,
      payload: { roleId: role.id },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().permissions).toEqual(["SALES_READ"]);
  });

  it("answers 404 for a role that does not exist", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_UPDATE], "admin");
    const user = await testPrisma.user.create({
      data: { name: "Someone", username: "someone", passwordHash: "x" },
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/users/${user.id}`,
      headers,
      payload: { roleId: "0199a1f0-0000-7000-8000-0000000000ff" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("ends every session of a user it deactivates", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_UPDATE], "admin");
    const target = await authenticateAs(app, [Permission.SALES_READ], "target");

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/users/${target.userId}`,
      headers,
      payload: { isActive: false },
    });

    const survivors = await testPrisma.refreshToken.count({ where: { userId: target.userId, revokedAt: null } });

    expect(response.statusCode).toBe(200);
    expect(survivors).toBe(0);
    expect((await app.inject({ method: "GET", url: "/v1/sessions/me", headers: target.headers })).statusCode).toBe(401);
  });

  it("answers 403 without ACCESS_UPDATE", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_READ], "admin");
    const user = await testPrisma.user.create({
      data: { name: "Someone", username: "someone", passwordHash: "x" },
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/users/${user.id}`,
      headers,
      payload: { isActive: false },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe("GET /v1/users", () => {
  it("lists users without any password material", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_READ], "admin");

    const response = await app.inject({ method: "GET", url: "/v1/users", headers });

    expect(response.statusCode).toBe(200);
    expect(JSON.stringify(response.json())).not.toContain("scrypt$");
  });
});
