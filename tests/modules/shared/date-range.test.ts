import { describe, expect, test } from "vitest";
import { dateRangeQuerySchema, dateRangeWhere } from "../../../src/modules/shared/date-range.js";

describe("dateRangeQuerySchema", () => {
  test("sem query, o intervalo fica aberto dos dois lados", () => {
    expect(dateRangeQuerySchema.parse({})).toEqual({});
  });

  test("aceita data pura e instante ISO 8601", () => {
    expect(dateRangeQuerySchema.parse({ from: "2026-08-01" }).from).toEqual(new Date("2026-08-01"));
    expect(dateRangeQuerySchema.parse({ to: "2026-08-01T13:45:00Z" }).to).toEqual(new Date("2026-08-01T13:45:00Z"));
  });

  test("recusa data ilegível", () => {
    expect(dateRangeQuerySchema.safeParse({ from: "ontem" }).success).toBe(false);
  });

  test("recusa intervalo invertido, que sempre devolveria vazio", () => {
    expect(dateRangeQuerySchema.safeParse({ from: "2026-08-10", to: "2026-08-01" }).success).toBe(false);
  });

  test("aceita as duas pontas iguais, que é um intervalo vazio pedido de propósito", () => {
    expect(dateRangeQuerySchema.safeParse({ from: "2026-08-01", to: "2026-08-01" }).success).toBe(true);
  });
});

describe("dateRangeWhere", () => {
  test("sem pontas, não filtra nada", () => {
    expect(dateRangeWhere({})).toEqual({});
  });

  test("intervalo é semiaberto: inclui o início, exclui o fim, para janelas consecutivas não se sobreporem", () => {
    const from = new Date("2026-08-01");
    const to = new Date("2026-08-08");

    expect(dateRangeWhere({ from, to })).toEqual({ createdAt: { gte: from, lt: to } });
  });

  test("cada ponta funciona sozinha", () => {
    const from = new Date("2026-08-01");
    const to = new Date("2026-08-08");

    expect(dateRangeWhere({ from })).toEqual({ createdAt: { gte: from } });
    expect(dateRangeWhere({ to })).toEqual({ createdAt: { lt: to } });
  });
});
