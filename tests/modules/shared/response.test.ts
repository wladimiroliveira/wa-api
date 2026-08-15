import { describe, expect, test } from "vitest";
import { Prisma } from "../../../src/generated/prisma/index.js";
import { decimalSchema, errorSchema, timestampSchema } from "../../../src/modules/shared/response.js";

describe("response schemas compartilhados", () => {
  test("decimalSchema converte Prisma.Decimal em number", () => {
    expect(decimalSchema.parse(new Prisma.Decimal("15.50"))).toBe(15.5);
  });

  test("decimalSchema aceita a string que o pricing já formata", () => {
    expect(decimalSchema.parse("65.00")).toBe(65);
  });

  test("timestampSchema aceita Date e serializa como ISO 8601", () => {
    const parsed = timestampSchema.parse(new Date("2026-08-15T12:00:00.000Z"));
    expect(JSON.stringify(parsed)).toBe('"2026-08-15T12:00:00.000Z"');
  });

  test("errorSchema aceita o erro de domínio com code", () => {
    expect(errorSchema.parse({ code: "DIMENSION_MISMATCH", message: "dimensões diferentes" })).toEqual({
      code: "DIMENSION_MISMATCH",
      message: "dimensões diferentes",
    });
  });

  test("errorSchema aceita o erro de validação que o Fastify gera", () => {
    const fastifyError = {
      statusCode: 400,
      code: "FST_ERR_VALIDATION",
      error: "Bad Request",
      message: "body inválido",
    };
    expect(errorSchema.parse(fastifyError)).toEqual(fastifyError);
  });

  test("errorSchema exige message", () => {
    expect(errorSchema.safeParse({ code: "X" }).success).toBe(false);
  });
});
