import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import prisma from "../../../src/lib/prisma.js";

describe("production routes (integração)", () => {
  let app: FastifyInstance;
  let supplyId: string;
  let recipeId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    // Insumo em UN, com 10 de saldo.
    supplyId = (await app.inject({
      method: "POST",
      url: "/supplies",
      payload: { name: "Massa (producao)", type: "INGREDIENT", purchaseUnit: "UN", purchaseQty: 1, purchasePrice: 45 },
    })).json().id;
    await app.inject({ method: "POST", url: `/supplies/${supplyId}/stock-entries`, payload: { quantity: 10, unit: "UN" } });
    // Receita: rende 100 un, consome 1 UN por lote.
    recipeId = (await app.inject({
      method: "POST",
      url: "/recipes",
      payload: {
        name: "Brigadeiro (producao)", batchYield: 100, laborCostPerHundred: 20, margin: 0.6,
        items: [{ supplyId, usageQty: 1, usageUnit: "UN" }],
      },
    })).json().id;
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { supplyId } }).catch((e) => console.warn("cleanup movements:", e));
    await prisma.production.deleteMany({ where: { recipeId } }).catch((e) => console.warn("cleanup productions:", e));
    await prisma.recipeItem.deleteMany({ where: { recipeId } }).catch(() => {});
    await prisma.recipe.delete({ where: { id: recipeId } }).catch((e) => console.warn("cleanup recipe:", e));
    await prisma.supply.delete({ where: { id: supplyId } }).catch((e) => console.warn("cleanup supply:", e));
    await app.close();
  });

  test("produção por producedQty consome e baixa o saldo, sem warnings", async () => {
    // producedQty 300 → fator 3 → consome 3 UN. Saldo 10 → 7.
    const res = await app.inject({
      method: "POST",
      url: "/productions",
      payload: { recipeId, producedQty: 300 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.production.producedUnits).toBe("300");
    expect(body.consumptions.find((c: { supplyId: string }) => c.supplyId === supplyId).consumedBase).toBe("3");
    expect(body.warnings).toHaveLength(0);

    const supply = await app.inject({ method: "GET", url: `/supplies/${supplyId}` });
    expect(supply.json().currentStock).toBe("7");
  });

  test("produção além do saldo registra e retorna warning de saldo negativo", async () => {
    // Saldo atual 7. producedQty 1000 → fator 10 → consome 10 UN → saldo -3.
    const res = await app.inject({
      method: "POST",
      url: "/productions",
      payload: { recipeId, producedQty: 1000 },
    });
    expect(res.statusCode).toBe(201);
    const warning = res.json().warnings.find((w: { supplyId: string }) => w.supplyId === supplyId);
    expect(warning).toBeDefined();
    expect(warning.resultingStock).toBe("-3");
  });

  test("receita inexistente → 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/productions",
      payload: { recipeId: "00000000-0000-0000-0000-000000000000", batches: 1 },
    });
    expect(res.statusCode).toBe(404);
  });
});
