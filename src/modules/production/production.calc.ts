import { Prisma, UnitOfMeasure } from "../../generated/prisma/index.js";
import { toBase } from "../shared/unit-of-measure.js";

export interface RecipeForProduction {
  batchYield: Prisma.Decimal;
  items: { supplyId: string; usageQty: Prisma.Decimal; usageUnit: UnitOfMeasure }[];
}

export interface ProductionSpec {
  batches?: Prisma.Decimal;
  producedQty?: Prisma.Decimal;
}

export interface ConsumptionResult {
  factor: Prisma.Decimal;
  producedUnits: Prisma.Decimal;
  consumptions: { supplyId: string; consumedBase: Prisma.Decimal }[];
}

// Consumo proporcional ao rendimento. Assume que exatamente um de batches/producedQty foi informado (validado no schema).
export function computeConsumption(recipe: RecipeForProduction, spec: ProductionSpec): ConsumptionResult {
  const factor = spec.batches ?? spec.producedQty!.div(recipe.batchYield);
  const producedUnits = factor.mul(recipe.batchYield);
  const consumptions = recipe.items.map((item) => ({
    supplyId: item.supplyId,
    consumedBase: toBase(item.usageQty, item.usageUnit).mul(factor),
  }));
  return { factor, producedUnits, consumptions };
}
