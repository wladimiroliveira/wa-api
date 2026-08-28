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

describe("POST /v1/roles", () => {
  it("creates a role with the permissions it was given", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_CREATE]);

    const response = await app.inject({
      method: "POST",
      url: "/v1/roles",
      headers,
      payload: { name: "Seller", permissions: [Permission.SALES_READ, Permission.SALES_CREATE] },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: "Seller", permissions: ["SALES_READ", "SALES_CREATE"] });
  });

  it("answers 403 without ACCESS_CREATE", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_READ]);

    const response = await app.inject({
      method: "POST",
      url: "/v1/roles",
      headers,
      payload: { name: "Seller", permissions: [] },
    });

    expect(response.statusCode).toBe(403);
  });

  it("answers 409 for a name another role already has", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_CREATE]);
    await testPrisma.role.create({ data: { name: "Seller", permissions: [] } });

    const response = await app.inject({
      method: "POST",
      url: "/v1/roles",
      headers,
      payload: { name: "Seller", permissions: [] },
    });

    expect(response.statusCode).toBe(409);
  });

  it("answers 400 for a permission that is not in the enum", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_CREATE]);

    const response = await app.inject({
      method: "POST",
      url: "/v1/roles",
      headers,
      payload: { name: "Seller", permissions: ["SALES_DESTROY"] },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("GET /v1/roles", () => {
  it("lists the roles in alphabetical order", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_READ]);
    await testPrisma.role.createMany({
      data: [
        { name: "Stocker", permissions: [] },
        { name: "Seller", permissions: [] },
      ],
    });

    const response = await app.inject({ method: "GET", url: "/v1/roles", headers });

    expect(response.json().map((role: { name: string }) => role.name)).toEqual(["Seller", "Stocker"]);
  });

  it("answers 401 without a token", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/roles" })).statusCode).toBe(401);
  });
});

describe("PATCH /v1/roles/:id", () => {
  it("replaces the permission package", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_UPDATE]);
    const role = await testPrisma.role.create({ data: { name: "Seller", permissions: ["SALES_READ"] } });

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/roles/${role.id}`,
      headers,
      payload: { permissions: [Permission.REPORTS_READ] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().permissions).toEqual(["REPORTS_READ"]);
  });

  it("answers 404 for a role that does not exist", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_UPDATE]);

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/roles/0199a1f0-0000-7000-8000-0000000000ff",
      headers,
      payload: { permissions: [] },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("DELETE /v1/roles/:id", () => {
  it("removes the role and leaves its users without inheritance", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_UPDATE]);
    const role = await testPrisma.role.create({ data: { name: "Seller", permissions: ["SALES_READ"] } });
    const user = await testPrisma.user.create({
      data: { name: "Someone", username: "someone", passwordHash: "x", roleId: role.id },
    });

    const response = await app.inject({ method: "DELETE", url: `/v1/roles/${role.id}`, headers });

    expect(response.statusCode).toBe(204);
    expect((await testPrisma.user.findUnique({ where: { id: user.id } }))?.roleId).toBeNull();
  });
});
