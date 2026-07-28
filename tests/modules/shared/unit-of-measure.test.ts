import { describe, expect, test } from "vitest";
import { Prisma, UnitOfMeasure } from "../../../src/generated/prisma/index.js";
import { dimensionOf, sameDimension, toBase } from "../../../src/modules/shared/unit-of-measure.js";

describe("unit-of-measure", () => {
  test("KG pertence à dimensão WEIGHT", () => {
    expect(dimensionOf(UnitOfMeasure.KG)).toBe("WEIGHT");
  });

  test("G e KG compartilham dimensão; G e ML não", () => {
    expect(sameDimension(UnitOfMeasure.G, UnitOfMeasure.KG)).toBe(true);
    expect(sameDimension(UnitOfMeasure.G, UnitOfMeasure.ML)).toBe(false);
  });

  test("UN e G não compartilham dimensão", () => {
    expect(sameDimension(UnitOfMeasure.UN, UnitOfMeasure.G)).toBe(false);
  });

  test("toBase converte KG para gramas (×1000)", () => {
    expect(toBase(new Prisma.Decimal(1), UnitOfMeasure.KG).equals(1000)).toBe(true);
  });

  test("toBase mantém unidade base (G, fator 1)", () => {
    expect(toBase(new Prisma.Decimal(200), UnitOfMeasure.G).equals(200)).toBe(true);
  });

  test("toBase converte L para mililitros (×1000)", () => {
    expect(toBase(new Prisma.Decimal(1), UnitOfMeasure.L).equals(1000)).toBe(true);
  });

  test("toBase mantém UN (fator 1)", () => {
    expect(toBase(new Prisma.Decimal(2), UnitOfMeasure.UN).equals(2)).toBe(true);
  });
});
