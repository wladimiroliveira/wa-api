import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import prisma from "../../../src/lib/prisma.js";
import { createActor, deleteActor, ALL_PERMISSIONS, type TestActor } from "../../helpers/auth.js";

describe("pricing routes (integração)", () => {
  let app: FastifyInstance;
  let actor: TestActor;
  let supplyId: string;
  let recipeId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    actor = await createActor(app, ALL_PERMISSIONS);

    const supplyRes = await app.inject({
      headers: actor.headers,
      method: "POST",
      url: "/supplies",
      payload: {
        name: "Leite condensado",
        type: "INGREDIENT",
        purchaseUnit: "UN",
        purchaseQty: 1,
        purchasePrice: 45.0,
      },
    });
    expect(supplyRes.statusCode).toBe(201);
    supplyId = supplyRes.json().id;

    const recipeRes = await app.inject({
      headers: actor.headers,
      method: "POST",
      url: "/recipes",
      payload: {
        name: "Brigadeiro",
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
      await prisma.recipe.delete({ where: { id: recipeId } }).catch((e) => console.warn("cleanup failed (recipe):", e));
    if (supplyId)
      await prisma.supply.delete({ where: { id: supplyId } }).catch((e) => console.warn("cleanup failed (supply):", e));
    await deleteActor(actor.userId);
    await app.close();
  });

  test("GET /recipes/:id/pricing retorna 200 com os valores do brigadeiro", async () => {
    const res = await app.inject({ headers: actor.headers, method: "GET", url: `/recipes/${recipeId}/pricing` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalCostPerHundred).toBe("65.00");
    expect(body.pricePerHundred).toBe("104.00");
    expect(body.pricePerHalfHundred).toBe("52.00");
  });

  test("POST /recipes com item de dimensão incompatível (ML sobre supply em UN) retorna 400", async () => {
    const res = await app.inject({
      headers: actor.headers,
      method: "POST",
      url: "/recipes",
      payload: {
        name: "Receita inválida",
        batchYield: 100,
        laborCostPerHundred: 20.0,
        margin: 0.6,
        items: [{ supplyId, usageQty: 1, usageUnit: "ML" }],
      },
    });

    expect(res.statusCode).toBe(400);
  });

  test("GET /recipes/:id/pricing com id inexistente retorna 404", async () => {
    const res = await app.inject({
      headers: actor.headers,
      method: "GET",
      url: "/recipes/00000000-0000-0000-0000-000000000000/pricing",
    });

    expect(res.statusCode).toBe(404);
  });

  test("POST /recipes com body inválido (campo faltando) ainda retorna 400 (error handler não quebra validação do zod)", async () => {
    const res = await app.inject({
      headers: actor.headers,
      method: "POST",
      url: "/recipes",
      payload: { name: "Sem campos obrigatórios" },
    });

    expect(res.statusCode).toBe(400);
  });

  test("PATCH /recipes/:id/margin com id inexistente retorna 404 (P2025 mapeado pelo error handler global)", async () => {
    const res = await app.inject({
      headers: actor.headers,
      method: "PATCH",
      url: "/recipes/00000000-0000-0000-0000-000000000000/margin",
      payload: { margin: 0.5 },
    });

    expect(res.statusCode).toBe(404);
  });

  test("DELETE /supplies/:id referenciado por um item de recipe retorna 409 (P2003 mapeado pelo error handler global)", async () => {
    // Supply e recipe dedicados: a exclusão é bloqueada pela FK Restrict e não pode
    // deixar o supply/recipe usados nos outros testes em estado inconsistente.
    const supplyRes = await app.inject({
      headers: actor.headers,
      method: "POST",
      url: "/supplies",
      payload: {
        name: "Chocolate em pó (referenciado)",
        type: "INGREDIENT",
        purchaseUnit: "UN",
        purchaseQty: 1,
        purchasePrice: 10.0,
      },
    });
    expect(supplyRes.statusCode).toBe(201);
    const referencedSupplyId = supplyRes.json().id;

    const recipeRes = await app.inject({
      headers: actor.headers,
      method: "POST",
      url: "/recipes",
      payload: {
        name: "Receita com insumo referenciado",
        batchYield: 100,
        laborCostPerHundred: 5.0,
        margin: 0.5,
        items: [{ supplyId: referencedSupplyId, usageQty: 1, usageUnit: "UN" }],
      },
    });
    expect(recipeRes.statusCode).toBe(201);
    const referencedRecipeId = recipeRes.json().id;

    const deleteRes = await app.inject({
      headers: actor.headers,
      method: "DELETE",
      url: `/supplies/${referencedSupplyId}`,
    });
    expect(deleteRes.statusCode).toBe(409);

    await prisma.recipe.delete({ where: { id: referencedRecipeId } });
    await prisma.supply.delete({ where: { id: referencedSupplyId } });
  });
});
