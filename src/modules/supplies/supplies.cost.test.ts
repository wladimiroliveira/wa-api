import { describe, expect, test } from "vitest";
import { Prisma, UnitOfMeasure } from "../../generated/prisma/index.js";
import { costPerBase } from "./supplies.cost.js";

describe("costPerBase", () => {
  test("chocolate: R$12,00 por 1 KG → R$0,012 por grama", () => {
    const result = costPerBase({
      purchasePrice: new Prisma.Decimal("12.00"),
      purchaseQty: new Prisma.Decimal(1),
      purchaseUnit: UnitOfMeasure.KG,
    });
    expect(result.equals("0.012")).toBe(true);
  });

  test("forminha: R$5,00 por 100 UN → R$0,05 por unidade", () => {
    const result = costPerBase({
      purchasePrice: new Prisma.Decimal("5.00"),
      purchaseQty: new Prisma.Decimal(100),
      purchaseUnit: UnitOfMeasure.UN,
    });
    expect(result.equals("0.05")).toBe(true);
  });
});
