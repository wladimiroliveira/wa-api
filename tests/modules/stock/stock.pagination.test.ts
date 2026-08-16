import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import prisma from "../../../src/lib/prisma.js";
import { createActor, deleteActor, ALL_PERMISSIONS, type TestActor } from "../../helpers/auth.js";

/**
 * O razão de um insumo é append-only e cresce na velocidade do uso. Os testes
 * abaixo gravam os movimentos direto no banco, com `createdAt` escolhido a dedo,
 * porque a ordem e os empates são exatamente o que a paginação precisa acertar.
 */
describe("GET /supplies/:id/movements — paginação por cursor (integração)", () => {
  let app: FastifyInstance;
  let actor: TestActor;
  let supplyId: string;

  const at = (iso: string) => new Date(iso);

  async function seedMovement(createdAt: Date) {
    return prisma.stockMovement.create({
      data: { supplyId, type: "ENTRY", quantityBase: 1, createdAt },
      select: { id: true },
    });
  }

  async function page(url: string) {
    const res = await app.inject({ headers: actor.headers, method: "GET", url });
    expect(res.statusCode).toBe(200);
    return res.json() as { data: { id: string }[]; nextCursor: string | null };
  }

  /** Percorre o razão inteiro seguindo os cursores e devolve os ids na ordem entregue. */
  async function walk(limit: number) {
    const ids: string[] = [];
    let cursor: string | null = null;

    do {
      const query = `limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`;
      const result = await page(`/supplies/${supplyId}/movements?${query}`);
      ids.push(...result.data.map((m) => m.id));
      cursor = result.nextCursor;
    } while (cursor);

    return ids;
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
          name: "Acucar (paginacao)",
          type: "INGREDIENT",
          purchaseUnit: "KG",
          purchaseQty: 1,
          purchasePrice: 4.0,
        },
      })
    ).json().id;
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { supplyId } }).catch((e) => console.warn("cleanup movements:", e));
    await prisma.supply.delete({ where: { id: supplyId } }).catch((e) => console.warn("cleanup supply:", e));
    await deleteActor(actor.userId);
    await app.close();
  });

  test("razão vazio devolve envelope vazio, não array", async () => {
    expect(await page(`/supplies/${supplyId}/movements`)).toEqual({ data: [], nextCursor: null });
  });

  test("percorre o razão inteiro em páginas, sem repetir nem pular, do mais novo ao mais antigo", async () => {
    const seeded = [];
    for (const day of ["01", "02", "03", "04", "05"]) {
      seeded.push(await seedMovement(at(`2026-03-${day}T10:00:00.000Z`)));
    }
    const newestFirst = seeded.map((m) => m.id).reverse();

    expect(await walk(2)).toEqual(newestFirst);
  });

  test("a última página vem sem cursor, mesmo quando enche exatamente o limite", async () => {
    const result = await page(`/supplies/${supplyId}/movements?limit=5`);

    expect(result.data).toHaveLength(5);
    expect(result.nextCursor).toBeNull();
  });

  test("movimentos da mesma transação empatam em createdAt e ainda assim saem uma única vez", async () => {
    // CURRENT_TIMESTAMP é o horário de início da transação: uma produção que
    // consome vários insumos grava todos os movimentos no mesmo instante.
    const tied = at("2026-03-06T10:00:00.000Z");
    const ids = [await seedMovement(tied), await seedMovement(tied), await seedMovement(tied)].map((m) => m.id);

    const walked = await walk(1);

    expect(new Set(walked).size).toBe(walked.length);
    expect(ids.every((id) => walked.includes(id))).toBe(true);
    expect(walked).toHaveLength(8); // 5 do teste anterior + 3 empatados
  });

  test("inserção entre duas páginas não faz um registro repetir nem sumir", async () => {
    const before = await walk(50);

    const first = await page(`/supplies/${supplyId}/movements?limit=3`);
    await seedMovement(at("2026-03-07T10:00:00.000Z")); // entra no topo, entre as duas leituras
    const second = await page(`/supplies/${supplyId}/movements?limit=3&cursor=${first.nextCursor}`);

    const seen = [...first.data, ...second.data].map((m) => m.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(before.slice(0, 6)); // o registro novo fica de fora, o resto avança em ordem
  });

  test("cursor desconhecido devolve página vazia, não erro", async () => {
    const result = await page(`/supplies/${supplyId}/movements?cursor=00000000-0000-4000-8000-000000000000`);

    expect(result).toEqual({ data: [], nextCursor: null });
  });

  test("limite fora da faixa e cursor malformado → 400", async () => {
    for (const query of ["limit=0", "limit=101", "limit=abc", "cursor=nope"]) {
      const res = await app.inject({
        headers: actor.headers,
        method: "GET",
        url: `/supplies/${supplyId}/movements?${query}`,
      });
      expect(res.statusCode, query).toBe(400);
    }
  });

  test("insumo inexistente continua 404, antes de qualquer paginação", async () => {
    const res = await app.inject({
      headers: actor.headers,
      method: "GET",
      url: "/supplies/00000000-0000-0000-0000-000000000000/movements?limit=1",
    });

    expect(res.statusCode).toBe(404);
  });
});
