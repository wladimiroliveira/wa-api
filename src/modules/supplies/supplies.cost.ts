import { Prisma, UnitOfMeasure } from "../../generated/prisma/index.js";
import { toBase } from "../shared/unit-of-measure.js";

export interface SupplyCostInput {
  purchasePrice: Prisma.Decimal;
  purchaseQty: Prisma.Decimal;
  purchaseUnit: UnitOfMeasure;
}

// Custo por unidade base (grama/ml/unidade) do insumo.
export function costPerBase(supply: SupplyCostInput): Prisma.Decimal {
  return supply.purchasePrice.div(toBase(supply.purchaseQty, supply.purchaseUnit));
}
