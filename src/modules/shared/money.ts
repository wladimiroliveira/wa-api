import { Prisma } from "../../generated/prisma/index.js";

export const ONE_REAL = new Prisma.Decimal(1);

// Arredonda para cima ao múltiplo de `step` (ex.: R$1,00), mantendo exatidão Decimal.
export function roundUpToNearest(value: Prisma.Decimal, step: Prisma.Decimal): Prisma.Decimal {
  return value.div(step).ceil().mul(step);
}
