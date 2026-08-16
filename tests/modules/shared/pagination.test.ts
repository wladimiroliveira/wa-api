import { describe, expect, test } from "vitest";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  cursorPageArgs,
  cursorPageQuerySchema,
  toPage,
} from "../../../src/modules/shared/pagination.js";

describe("cursorPageQuerySchema", () => {
  test("sem query, o limite cai no padrão e o cursor fica ausente", () => {
    expect(cursorPageQuerySchema.parse({})).toEqual({ limit: DEFAULT_PAGE_LIMIT });
  });

  test("aceita o limite como string, porque a querystring nunca traz number", () => {
    expect(cursorPageQuerySchema.parse({ limit: "10" }).limit).toBe(10);
  });

  test("recusa limite fora da faixa e não inteiro", () => {
    for (const limit of ["0", "-1", "2.5", String(MAX_PAGE_LIMIT + 1)]) {
      expect(cursorPageQuerySchema.safeParse({ limit }).success).toBe(false);
    }
  });

  test("recusa cursor que não é uuid", () => {
    expect(cursorPageQuerySchema.safeParse({ cursor: "not-a-uuid" }).success).toBe(false);
  });
});

describe("cursorPageArgs", () => {
  test("desempata por id, porque createdAt repete dentro da mesma transação", () => {
    expect(cursorPageArgs({ limit: 5 }).orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  test("pede uma linha a mais que o limite, para saber se há próxima página sem contar a tabela", () => {
    expect(cursorPageArgs({ limit: 5 }).take).toBe(6);
  });

  test("sem cursor, a primeira página não pula nada", () => {
    const args = cursorPageArgs({ limit: 5 });
    expect(args).not.toHaveProperty("cursor");
    expect(args).not.toHaveProperty("skip");
  });

  test("com cursor, pula a própria linha do cursor", () => {
    const args = cursorPageArgs({ limit: 5, cursor: "a3f1c2d4-0000-4000-8000-000000000000" });
    expect(args).toMatchObject({ cursor: { id: "a3f1c2d4-0000-4000-8000-000000000000" }, skip: 1 });
  });
});

describe("toPage", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id-${i}` }));

  test("página incompleta é a última: sem próximo cursor", () => {
    expect(toPage(rows(3), 5)).toEqual({ data: rows(3), nextCursor: null });
  });

  test("página exatamente cheia ainda é a última, porque a linha-sonda não veio", () => {
    expect(toPage(rows(5), 5)).toEqual({ data: rows(5), nextCursor: null });
  });

  test("a linha-sonda é descartada e o cursor aponta para o último item entregue", () => {
    expect(toPage(rows(6), 5)).toEqual({ data: rows(5), nextCursor: "id-4" });
  });

  test("coleção vazia não inventa cursor", () => {
    expect(toPage([], 5)).toEqual({ data: [], nextCursor: null });
  });
});
