import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import prisma from "../../../src/lib/prisma.js";
import { createActor, deleteActor, ALL_PERMISSIONS, type TestActor } from "../../helpers/auth.js";

/**
 * `/productions` é global, então as produções daqui nascem numa janela própria
 * (maio de 2026) e toda asserção de conteúdo recorta essa janela.
 */
describe("GET /productions — paginação e intervalo (integração)", () => {
  let app: FastifyInstance;
  let actor: TestActor;
  let supplyId: string;
  let recipeId: string;

  const WINDOW = { from: "2026-05-01T00:00:00.000Z", to: "2026-05-08T00:00:00.000Z" };

  async function seedProduction(createdAt: string) {
    return prisma.production.create({
      data: { recipeId, factor: 1, producedUnits: 100, createdAt: new Date(createdAt) },
      select: { id: true },
    });
  }

  async function page(query: string) {
    const res = await app.inject({ headers: actor.headers, method: "GET", url: `/productions?${query}` });
    expect(res.statusCode).toBe(200);
    return res.json() as { data: { id: string; createdAt: string }[]; nextCursor: string | null };
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    actor = await createActor(app, ALL_PERMISSIONS);
    supplyId = (
      await app.inject({
        headers: actor.headers,
        method: "POST",
        url: "/supplies",
        payload: {
          name: "Leite (producoes paginadas)",
          type: "INGREDIENT",
          purchaseUnit: "L",
          purchaseQty: 1,
          purchasePrice: 6.0,
        },
      })
    ).json().id;
    recipeId = (
      await app.inject({
        headers: actor.headers,
        method: "POST",
        url: "/recipes",
        payload: {
          name: "Pudim (producoes paginadas)",
          batchYield: 100,
          laborCostPerHundred: 10,
          margin: 0.5,
          items: [{ supplyId, usageQty: 1, usageUnit: "L" }],
        },
      })
    ).json().id;

    await seedProduction("2026-04-30T23:59:59.999Z");
    await seedProduction("2026-05-01T00:00:00.000Z"); // o início entra
    await seedProduction("2026-05-04T12:00:00.000Z");
    await seedProduction("2026-05-07T23:59:59.999Z");
    await seedProduction("2026-05-08T00:00:00.000Z"); // o fim fica de fora
  });

  afterAll(async () => {
    await prisma.production.deleteMany({ where: { recipeId } }).catch((e) => console.warn("cleanup productions:", e));
    await prisma.stockMovement.deleteMany({ where: { supplyId } }).catch((e) => console.warn("cleanup movements:", e));
    await prisma.recipeItem.deleteMany({ where: { recipeId } }).catch((e) => console.warn("cleanup recipeItems:", e));
    await prisma.recipe.delete({ where: { id: recipeId } }).catch((e) => console.warn("cleanup recipe:", e));
    await prisma.supply.delete({ where: { id: supplyId } }).catch((e) => console.warn("cleanup supply:", e));
    await deleteActor(actor.userId);
    await app.close();
  });

  test("intervalo semiaberto: inclui o instante inicial e exclui o final", async () => {
    const result = await page(`from=${WINDOW.from}&to=${WINDOW.to}`);

    expect(result.data).toHaveLength(3);
    expect(result.nextCursor).toBeNull();
  });

  test("dentro da janela, o cursor entrega tudo do mais novo ao mais antigo", async () => {
    const ids: string[] = [];
    let cursor: string | null = null;

    do {
      const query = `from=${WINDOW.from}&to=${WINDOW.to}&limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const result = await page(query);
      ids.push(...result.data.map((p) => p.id));
      cursor = result.nextCursor;
    } while (cursor);

    const expected = await page(`from=${WINDOW.from}&to=${WINDOW.to}`);
    expect(ids).toEqual(expected.data.map((p) => p.id));
  });

  test("a primeira página respeita o limite e anuncia a próxima", async () => {
    const result = await page(`from=${WINDOW.from}&to=${WINDOW.to}&limit=2`);

    expect(result.data).toHaveLength(2);
    expect(result.nextCursor).toBe(result.data[1].id);
  });

  test("intervalo invertido → 400", async () => {
    const res = await app.inject({
      headers: actor.headers,
      method: "GET",
      url: `/productions?from=${WINDOW.to}&to=${WINDOW.from}`,
    });

    expect(res.statusCode).toBe(400);
  });

  test("limite acima do teto → 400", async () => {
    const res = await app.inject({ headers: actor.headers, method: "GET", url: "/productions?limit=101" });

    expect(res.statusCode).toBe(400);
  });
});
