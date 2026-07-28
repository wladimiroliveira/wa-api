import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import prisma from "../../../src/lib/prisma.js";

describe("stock routes (integração)", () => {
  let app: FastifyInstance;
  let supplyId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/supplies",
      payload: { name: "Chocolate (estoque)", type: "INGREDIENT", purchaseUnit: "KG", purchaseQty: 1, purchasePrice: 12.0 },
    });
    supplyId = res.json().id;
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { supplyId } }).catch((e) => console.warn("cleanup movements:", e));
    await prisma.supply.delete({ where: { id: supplyId } }).catch((e) => console.warn("cleanup supply:", e));
    await app.close();
  });

  test("entrada incrementa o saldo e cria movimento ENTRY", async () => {
    const entry = await app.inject({
      method: "POST",
      url: `/supplies/${supplyId}/stock-entries`,
      payload: { quantity: 2, unit: "KG" }, // 2 KG = 2000 g
    });
    expect(entry.statusCode).toBe(201);
    expect(entry.json().currentStock).toBe("2000");

    const supply = await app.inject({ method: "GET", url: `/supplies/${supplyId}` });
    expect(supply.json().currentStock).toBe("2000");

    const movements = await app.inject({ method: "GET", url: `/supplies/${supplyId}/movements` });
    expect(movements.json()).toHaveLength(1);
    expect(movements.json()[0].type).toBe("ENTRY");
    expect(movements.json()[0].quantityBase).toBe("2000");
  });

  test("dimensão incompatível (insumo em KG, entrada em ML) → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/supplies/${supplyId}/stock-entries`,
      payload: { quantity: 100, unit: "ML" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("DIMENSION_MISMATCH");
  });

  test("movements de insumo inexistente → 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/supplies/00000000-0000-0000-0000-000000000000/movements",
    });
    expect(res.statusCode).toBe(404);
  });
});
