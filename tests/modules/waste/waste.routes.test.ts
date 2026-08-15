import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import prisma from "../../../src/lib/prisma.js";
import { createActor, deleteActor, ALL_PERMISSIONS, type TestActor } from "../../helpers/auth.js";

describe("waste routes (integração)", () => {
  let app: FastifyInstance;
  let actor: TestActor;
  let supplyId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    actor = await createActor(app, ALL_PERMISSIONS);
    const res = await app.inject({
      headers: actor.headers,
      method: "POST",
      url: "/supplies",
      payload: { name: "Farinha (avaria)", type: "INGREDIENT", purchaseUnit: "KG", purchaseQty: 1, purchasePrice: 5.0 },
    });
    supplyId = res.json().id;
    await app.inject({
      headers: actor.headers,
      method: "POST",
      url: `/supplies/${supplyId}/stock-entries`,
      payload: { quantity: 1, unit: "KG" },
    }); // 1000 g
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { supplyId } }).catch((e) => console.warn("cleanup movements:", e));
    await prisma.supply.delete({ where: { id: supplyId } }).catch((e) => console.warn("cleanup supply:", e));
    await deleteActor(actor.userId);
    await app.close();
  });

  test("avaria decrementa o saldo e cria movimento WASTE", async () => {
    const res = await app.inject({
      headers: actor.headers,
      method: "POST",
      url: `/supplies/${supplyId}/wastes`,
      payload: { quantity: 200, unit: "G", reason: "SPOILED" }, // -200 g
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().currentStock).toBe(800); // 1000 - 200

    const wastes = await app.inject({ headers: actor.headers, method: "GET", url: "/wastes" });
    const mine = wastes.json().filter((w: { supplyId: string }) => w.supplyId === supplyId);
    expect(mine).toHaveLength(1);
    expect(mine[0].type).toBe("WASTE");
    expect(mine[0].reason).toBe("SPOILED");
    expect(mine[0].quantityBase).toBe(-200);
  });

  test("reason ausente → 400 (validação)", async () => {
    const res = await app.inject({
      headers: actor.headers,
      method: "POST",
      url: `/supplies/${supplyId}/wastes`,
      payload: { quantity: 50, unit: "G" },
    });
    expect(res.statusCode).toBe(400);
  });
});
