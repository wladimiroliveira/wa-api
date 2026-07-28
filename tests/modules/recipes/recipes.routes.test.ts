import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import prisma from "../../../src/lib/prisma.js";

describe("PATCH /recipes/:id (integração)", () => {
  let app: FastifyInstance;
  let supplyId: string;
  let otherSupplyId: string;
  let recipeId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const supplyRes = await app.inject({
      method: "POST",
      url: "/supplies",
      payload: {
        name: "Chocolate granulado",
        type: "INGREDIENT",
        purchaseUnit: "UN",
        purchaseQty: 1,
        purchasePrice: 20.0,
      },
    });
    expect(supplyRes.statusCode).toBe(201);
    supplyId = supplyRes.json().id;

    const otherSupplyRes = await app.inject({
      method: "POST",
      url: "/supplies",
      payload: {
        name: "Manteiga",
        type: "INGREDIENT",
        purchaseUnit: "KG",
        purchaseQty: 1,
        purchasePrice: 30.0,
      },
    });
    expect(otherSupplyRes.statusCode).toBe(201);
    otherSupplyId = otherSupplyRes.json().id;

    const recipeRes = await app.inject({
      method: "POST",
      url: "/recipes",
      payload: {
        name: "Brigadeiro gourmet",
        batchYield: 100,
        laborCostPerHundred: 20.0,
        margin: 0.6,
        items: [{ supplyId, usageQty: 1, usageUnit: "UN" }],
      },
    });
    expect(recipeRes.statusCode).toBe(201);
    recipeId = recipeRes.json().id;
  });

  afterAll(async () => {
    if (recipeId)
      await prisma.recipe
        .delete({ where: { id: recipeId } })
        .catch((e) => console.warn("cleanup failed (recipe):", e));
    if (supplyId)
      await prisma.supply
        .delete({ where: { id: supplyId } })
        .catch((e) => console.warn("cleanup failed (supply):", e));
    if (otherSupplyId)
      await prisma.supply
        .delete({ where: { id: otherSupplyId } })
        .catch((e) => console.warn("cleanup failed (other supply):", e));
    await app.close();
  });

  test("altera name e laborCostPerHundred sem enviar items: retorna 200 e preserva os itens", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/recipes/${recipeId}`,
      payload: { name: "Brigadeiro gourmet premium", laborCostPerHundred: 25.0 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Brigadeiro gourmet premium");
    expect(body.laborCostPerHundred).toBe("25");
    expect(body.items).toHaveLength(1);
    expect(body.items[0].supplyId).toBe(supplyId);
  });

  test("envia items novos: substitui os itens existentes", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/recipes/${recipeId}`,
      payload: {
        items: [
          { supplyId, usageQty: 2, usageUnit: "UN" },
          { supplyId: otherSupplyId, usageQty: 0.5, usageUnit: "KG" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(2);
    const items = body.items as { supplyId: string; usageQty: string; usageUnit: string }[];
    const usageQtys = items.map((i) => i.usageQty).sort();
    expect(usageQtys).toEqual(["0.5", "2"]);

    const bySupply = new Map(items.map((i) => [i.supplyId, i]));
    expect(bySupply.get(supplyId)?.usageUnit).toBe("UN");
    expect(bySupply.get(otherSupplyId)?.usageUnit).toBe("KG");
    expect(bySupply.has(supplyId)).toBe(true);
    expect(bySupply.has(otherSupplyId)).toBe(true);
  });

  test("item com dimensão incompatível (ML sobre supply em UN) retorna 400", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/recipes/${recipeId}`,
      payload: {
        items: [{ supplyId, usageQty: 1, usageUnit: "ML" }],
      },
    });

    expect(res.statusCode).toBe(400);
  });

  test("id inexistente com body válido retorna 404 (P2025 mapeado pelo error handler global)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/recipes/00000000-0000-0000-0000-000000000000",
      payload: {
        name: "Não existe",
        items: [{ supplyId, usageQty: 1, usageUnit: "UN" }],
      },
    });

    expect(res.statusCode).toBe(404);
  });
});
