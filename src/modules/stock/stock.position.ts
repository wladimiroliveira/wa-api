import { Prisma } from "../../generated/prisma/index.js";

export const StockStatus = {
  NEGATIVE: "NEGATIVE",
  EMPTY: "EMPTY",
  BELOW_MINIMUM: "BELOW_MINIMUM",
  OK: "OK",
} as const;

type StockBalance = {
  quantity: Prisma.Decimal;
  averageCost: Prisma.Decimal | null;
  minimumQuantity: Prisma.Decimal | null;
};

const ZERO = new Prisma.Decimal(0);

export function statusOf({ quantity, minimumQuantity }: StockBalance) {
  if (quantity.lt(0)) return StockStatus.NEGATIVE;
  if (quantity.eq(0)) return StockStatus.EMPTY;
  if (minimumQuantity !== null && quantity.lt(minimumQuantity)) return StockStatus.BELOW_MINIMUM;

  return StockStatus.OK;
}

// What the balance is worth at its average cost, in cents. A negative balance is stock that is
// owed, not held, so it is worth nothing rather than a negative amount.
export function valueOf({ quantity, averageCost }: StockBalance): Prisma.Decimal {
  if (averageCost === null || quantity.lte(0)) return ZERO;

  return quantity.mul(averageCost).toDecimalPlaces(2);
}
