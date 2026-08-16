import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import prisma from "../../../src/lib/prisma.js";
import { createActor, deleteActor, ALL_PERMISSIONS, type TestActor } from "../../helpers/auth.js";

/**
 * `/wastes` é uma lista global: outros testes gravam nela ao mesmo tempo. Por
 * isso as perdas daqui nascem numa janela de tempo própria (abril de 2026), e as
 * asserções sobre conteúdo sempre recortam essa janela.
 */
describe("GET /wastes — paginação e intervalo (integração)", () => {
  let app: FastifyInstance;
  let actor: TestActor;
  let supplyId: string;

  const WINDOW = { from: "2026-04-01T00:00:00.000Z", to: "2026-04-08T00:00:00.000Z" };

  async function seedWaste(createdAt: string) {
    return prisma.stockMovement.create({
      data: { supplyId, type: "WASTE", quantityBase: -1, reason: "SPOILED", createdAt: new Date(createdAt) },
      select: { id: true },
    });
  }

  async function page(query: string) {
    const res = await app.inject({ headers: actor.headers, method: "GET", url: `/wastes?${query}` });
    expect(res.statusCode).toBe(200);
    return res.json() as { data: { id: string; supply: { id: string } }[]; nextCursor: string | null };
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
          name: "Creme (perdas paginadas)",
          type: "INGREDIENT",
          purchaseUnit: "L",
          purchaseQty: 1,
          purchasePrice: 9.0,
        },
      })
    ).json().id;

    // Três dentro da janela, uma antes e uma depois.
    await seedWaste("2026-03-31T23:59:59.999Z");
    await seedWaste("2026-04-01T00:00:00.000Z"); // o início entra: intervalo semiaberto
    await seedWaste("2026-04-04T12:00:00.000Z");
    await seedWaste("2026-04-07T23:59:59.999Z");
    await seedWaste("2026-04-08T00:00:00.000Z"); // o fim fica de fora
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { supplyId } }).catch((e) => console.warn("cleanup movements:", e));
    await prisma.supply.delete({ where: { id: supplyId } }).catch((e) => console.warn("cleanup supply:", e));
    await deleteActor(actor.userId);
    await app.close();
  });

  test("a resposta é envelope, e cada perda ainda traz o insumo aninhado", async () => {
    const result = await page(`from=${WINDOW.from}&to=${WINDOW.to}`);

    expect(result.data.every((w) => w.supply.id === supplyId)).toBe(true);
  });

  test("intervalo semiaberto: inclui o instante inicial e exclui o final", async () => {
    const result = await page(`from=${WINDOW.from}&to=${WINDOW.to}`);

    expect(result.data).toHaveLength(3);
    expect(result.nextCursor).toBeNull();
  });

  test("o cursor percorre a janela sem repetir nem pular", async () => {
    const ids: string[] = [];
    let cursor: string | null = null;

    do {
      const query = `from=${WINDOW.from}&to=${WINDOW.to}&limit=1${cursor ? `&cursor=${cursor}` : ""}`;
      const result = await page(query);
      ids.push(...result.data.map((w) => w.id));
      cursor = result.nextCursor;
    } while (cursor);

    expect(new Set(ids).size).toBe(3);
  });

  test("só o começo da janela também filtra", async () => {
    const result = await page(`from=2026-04-04T12:00:00.000Z&to=${WINDOW.to}`);

    expect(result.data).toHaveLength(2);
  });

  test("intervalo invertido → 400", async () => {
    const res = await app.inject({
      headers: actor.headers,
      method: "GET",
      url: `/wastes?from=${WINDOW.to}&to=${WINDOW.from}`,
    });

    expect(res.statusCode).toBe(400);
  });

  test("data ilegível → 400", async () => {
    const res = await app.inject({ headers: actor.headers, method: "GET", url: "/wastes?from=ontem" });

    expect(res.statusCode).toBe(400);
  });
});
