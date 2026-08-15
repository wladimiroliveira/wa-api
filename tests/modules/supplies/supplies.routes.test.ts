import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import prisma from "../../../src/lib/prisma.js";
import { createActor, deleteActor, ALL_PERMISSIONS, type TestActor } from "../../helpers/auth.js";

const MISSING_ID = "00000000-0000-0000-0000-000000000000";

describe("supplies routes (integração)", () => {
  let app: FastifyInstance;
  let actor: TestActor;
  const createdIds: string[] = [];

  async function createSupply(name: string) {
    const res = await app.inject({
      headers: actor.headers,
      method: "POST",
      url: "/supplies",
      payload: { name, type: "INGREDIENT", purchaseUnit: "KG", purchaseQty: 2, purchasePrice: 15.5 },
    });
    createdIds.push(res.json().id);
    return res;
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    actor = await createActor(app, ALL_PERMISSIONS);
  });

  afterAll(async () => {
    await prisma.supply
      .deleteMany({ where: { id: { in: createdIds } } })
      .catch((e) => console.warn("cleanup supplies:", e));
    await deleteActor(actor.userId);
    await app.close();
  });

  test("cria insumo com 201 e devolve os dados persistidos", async () => {
    const res = await createSupply("Açúcar (crud)");

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      name: "Açúcar (crud)",
      type: "INGREDIENT",
      purchaseUnit: "KG",
      purchaseQty: 2,
      purchasePrice: 15.5,
      currentStock: 0,
    });
  });

  test("rejeita payload inválido com 400", async () => {
    const res = await app.inject({
      headers: actor.headers,
      method: "POST",
      url: "/supplies",
      payload: { name: "", type: "INGREDIENT", purchaseUnit: "KG", purchaseQty: 0, purchasePrice: 1 },
    });

    expect(res.statusCode).toBe(400);
  });

  test("lista traz o insumo recém-criado", async () => {
    const created = await createSupply("Manteiga (crud)");

    const res = await app.inject({ headers: actor.headers, method: "GET", url: "/supplies" });

    expect(res.statusCode).toBe(200);
    expect(res.json().map((s: { id: string }) => s.id)).toContain(created.json().id);
  });

  test("busca insumo existente por id", async () => {
    const created = await createSupply("Ovos (crud)");

    const res = await app.inject({ headers: actor.headers, method: "GET", url: `/supplies/${created.json().id}` });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Ovos (crud)");
  });

  test("busca de insumo inexistente → 404", async () => {
    const res = await app.inject({ headers: actor.headers, method: "GET", url: `/supplies/${MISSING_ID}` });

    expect(res.statusCode).toBe(404);
  });

  test("edição parcial altera só os campos enviados", async () => {
    const created = await createSupply("Leite (crud)");

    const res = await app.inject({
      headers: actor.headers,
      method: "PATCH",
      url: `/supplies/${created.json().id}`,
      payload: { purchasePrice: 9.9 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: "Leite (crud)", purchaseQty: 2, purchasePrice: 9.9 });
  });

  test("edição de insumo inexistente → 404", async () => {
    const res = await app.inject({
      headers: actor.headers,
      method: "PATCH",
      url: `/supplies/${MISSING_ID}`,
      payload: { purchasePrice: 1 },
    });

    expect(res.statusCode).toBe(404);
  });

  test("remoção devolve 204 e o insumo deixa de ser encontrado", async () => {
    const created = await createSupply("Fermento (crud)");
    const id = created.json().id;

    const del = await app.inject({ headers: actor.headers, method: "DELETE", url: `/supplies/${id}` });
    expect(del.statusCode).toBe(204);
    expect(del.body).toBe("");

    const get = await app.inject({ headers: actor.headers, method: "GET", url: `/supplies/${id}` });
    expect(get.statusCode).toBe(404);
  });

  test("remoção de insumo inexistente → 404", async () => {
    const res = await app.inject({ headers: actor.headers, method: "DELETE", url: `/supplies/${MISSING_ID}` });

    expect(res.statusCode).toBe(404);
  });

  test("remoção de insumo usado por uma receita → 409", async () => {
    const created = await createSupply("Chocolate (em uso)");
    const supplyId = created.json().id;

    const recipe = await app.inject({
      headers: actor.headers,
      method: "POST",
      url: "/recipes",
      payload: {
        name: "Receita que usa insumo (crud)",
        batchYield: 100,
        laborCostPerHundred: 20,
        margin: 0.6,
        items: [{ supplyId, usageQty: 500, usageUnit: "G" }],
      },
    });
    const recipeId = recipe.json().id;

    try {
      const res = await app.inject({ headers: actor.headers, method: "DELETE", url: `/supplies/${supplyId}` });
      expect(res.statusCode).toBe(409);
    } finally {
      await prisma.recipe.delete({ where: { id: recipeId } }).catch((e) => console.warn("cleanup recipe:", e));
    }
  });
});
