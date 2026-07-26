import { UnitOfMeasure } from "../../generated/prisma/index.js";
import { sameDimension } from "../shared/unit-of-measure.js";

export class DimensionMismatchError extends Error {
  readonly code = "DIMENSION_MISMATCH";
  constructor(supplyUnit: UnitOfMeasure, usageUnit: UnitOfMeasure) {
    super(`Não é possível consumir em ${usageUnit} um insumo medido em ${supplyUnit} (dimensões diferentes).`);
    this.name = "DimensionMismatchError";
  }
}

export function assertItemDimension(supplyUnit: UnitOfMeasure, usageUnit: UnitOfMeasure): void {
  if (!sameDimension(supplyUnit, usageUnit)) {
    throw new DimensionMismatchError(supplyUnit, usageUnit);
  }
}
