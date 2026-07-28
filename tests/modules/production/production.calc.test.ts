import { describe, expect, test } from "vitest";
import { Prisma, UnitOfMeasure } from "../../../src/generated/prisma/index.js";
import { computeConsumption } from "../../../src/modules/production/production.calc.js";

// Receita: rende 100 un; consome 1 UN de um insumo A (custo irrelevante aqui) e 200 G de um insumo B, por lote.
const recipe = {
  batchYield: new Prisma.Decimal(100),
  items: [
    { supplyId: "A", usageQty: new Prisma.Decimal(1), usageUnit: UnitOfMeasure.UN },
    { supplyId: "B", usageQty: new Prisma.Decimal(200), usageUnit: UnitOfMeasure.G },
  ],
};

describe("computeConsumption", () => {
  test("por batches: 2 lotes → fator 2, 200 unidades, consumo escalado", () => {
    const r = computeConsumption(recipe, { batches: new Prisma.Decimal(2) });
    expect(r.factor.equals(2)).toBe(true);
    expect(r.producedUnits.equals(200)).toBe(true);
    expect(r.consumptions.find((c) => c.supplyId === "A")!.consumedBase.equals(2)).toBe(true); // 1 UN × 2
    expect(r.consumptions.find((c) => c.supplyId === "B")!.consumedBase.equals(400)).toBe(true); // 200 G × 2
  });

  test("por producedQty: 300 un de um lote que rende 100 → fator 3", () => {
    const r = computeConsumption(recipe, { producedQty: new Prisma.Decimal(300) });
    expect(r.factor.equals(3)).toBe(true);
    expect(r.producedUnits.equals(300)).toBe(true);
    expect(r.consumptions.find((c) => c.supplyId === "B")!.consumedBase.equals(600)).toBe(true); // 200 G × 3
  });
});
