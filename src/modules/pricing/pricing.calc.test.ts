import { describe, expect, test } from "vitest";
import { Prisma, UnitOfMeasure } from "../../generated/prisma/index.js";
import { calculatePricing } from "./pricing.calc.js";

describe("calculatePricing (cento de brigadeiro)", () => {
  // Lote de 100 un que consome R$45 em insumos (1 insumo: R$45 por 1 UN, usa 1 UN).
  const recipe = {
    batchYield: new Prisma.Decimal(100),
    laborCostPerHundred: new Prisma.Decimal("20.00"),
    margin: new Prisma.Decimal("0.60"),
    items: [
      {
        usageQty: new Prisma.Decimal(1),
        usageUnit: UnitOfMeasure.UN,
        supply: {
          purchasePrice: new Prisma.Decimal("45.00"),
          purchaseQty: new Prisma.Decimal(1),
          purchaseUnit: UnitOfMeasure.UN,
        },
      },
    ],
  };

  test("custo total por cento = R$65", () => {
    expect(calculatePricing(recipe).totalCostPerHundred.equals("65")).toBe(true);
  });

  test("preço exato (markup 60%) = R$104", () => {
    expect(calculatePricing(recipe).exactPrice.equals("104")).toBe(true);
  });

  test("preço do cento arredondado = R$104", () => {
    expect(calculatePricing(recipe).pricePerHundred.equals("104")).toBe(true);
  });

  test("preço do meio-cento = R$52", () => {
    expect(calculatePricing(recipe).pricePerHalfHundred.equals("52")).toBe(true);
  });

  test("arredondamento pra cima: custo 40 margem 0,6 → exato 64 fica 64; 40,10 vira 65", () => {
    const r2 = { ...recipe, laborCostPerHundred: new Prisma.Decimal("0.10"), items: recipe.items };
    // suppliesPerHundred 45 + 0,10 = 45,10; ×1,6 = 72,16 → arredonda 73
    expect(calculatePricing(r2).pricePerHundred.equals("73")).toBe(true);
  });
});
