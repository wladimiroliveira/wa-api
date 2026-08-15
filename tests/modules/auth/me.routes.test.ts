import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import { createActor, deleteActor, type TestActor } from "../../helpers/auth.js";
import { Permission } from "../../../src/generated/prisma/index.js";

describe("GET /me", () => {
  let app: FastifyInstance;
  let actor: TestActor;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    actor = await createActor(app, [Permission.STOCK_READ, Permission.PRICING_READ]);
  });

  afterAll(async () => {
    await deleteActor(actor.userId);
    await app.close();
  });

  test("devolve o usuário atual e suas permissões efetivas", async () => {
    const res = await app.inject({ method: "GET", url: "/me", headers: actor.headers });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(actor.userId);
    expect(res.json().permissions.sort()).toEqual([Permission.PRICING_READ, Permission.STOCK_READ].sort());
  });

  test("sem token → 401", async () => {
    expect((await app.inject({ method: "GET", url: "/me" })).statusCode).toBe(401);
  });
});
