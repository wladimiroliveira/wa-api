import { describe, expect, test } from "vitest";
import { UnitOfMeasure } from "../../generated/prisma/index.js";
import { assertItemDimension, DimensionMismatchError } from "./recipes.validation.js";

describe("assertItemDimension", () => {
  test("mesma dimensão (KG comprado, G usado) não lança", () => {
    expect(() => assertItemDimension(UnitOfMeasure.KG, UnitOfMeasure.G)).not.toThrow();
  });

  test("dimensões diferentes (KG comprado, ML usado) lança DimensionMismatchError", () => {
    expect(() => assertItemDimension(UnitOfMeasure.KG, UnitOfMeasure.ML)).toThrow(
      DimensionMismatchError,
    );
  });
});
