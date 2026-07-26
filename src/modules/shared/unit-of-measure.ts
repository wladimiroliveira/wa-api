import { Prisma, UnitOfMeasure } from "../../generated/prisma/index.js";

export type Dimension = "WEIGHT" | "VOLUME" | "COUNT";

export const UNIT_METADATA: Record<UnitOfMeasure, { dimension: Dimension; factorToBase: number }> = {
  G: { dimension: "WEIGHT", factorToBase: 1 },
  KG: { dimension: "WEIGHT", factorToBase: 1000 },
  ML: { dimension: "VOLUME", factorToBase: 1 },
  L: { dimension: "VOLUME", factorToBase: 1000 },
  UN: { dimension: "COUNT", factorToBase: 1 },
};

export function dimensionOf(unit: UnitOfMeasure): Dimension {
  return UNIT_METADATA[unit].dimension;
}

export function sameDimension(a: UnitOfMeasure, b: UnitOfMeasure): boolean {
  return dimensionOf(a) === dimensionOf(b);
}

export function toBase(qty: Prisma.Decimal, unit: UnitOfMeasure): Prisma.Decimal {
  return qty.mul(UNIT_METADATA[unit].factorToBase);
}
