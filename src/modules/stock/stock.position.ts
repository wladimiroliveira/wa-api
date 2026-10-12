import { Prisma } from "../../generated/prisma/index.js";
import { addDays, toDateString } from "../../lib/dates.js";

// In order of urgency: a product is read as the first of these that applies to it.
export const StockStatus = {
  NEGATIVE: "NEGATIVE",
  EMPTY: "EMPTY",
  EXPIRED: "EXPIRED",
  EXPIRING_SOON: "EXPIRING_SOON",
  BELOW_MINIMUM: "BELOW_MINIMUM",
  OK: "OK",
} as const;

export const LotStatus = {
  DEPLETED: "DEPLETED",
  EXPIRED: "EXPIRED",
  EXPIRING_SOON: "EXPIRING_SOON",
  OK: "OK",
} as const;

// How far ahead a lot is already worth a warning.
const EXPIRING_SOON_DAYS = 30;

type StockBalance = { quantity: Prisma.Decimal; minimumQuantity: Prisma.Decimal | null };
type Lot = { quantity: Prisma.Decimal; unitCost: Prisma.Decimal; expiresAt: Date | null };

const ZERO = new Prisma.Decimal(0);

// A lot with nothing left is history: it neither expires nor is worth anything.
const held = <L extends Lot>(lots: L[]) => lots.filter((lot) => lot.quantity.gt(0));

// A lot is good through the day it expires on, and expired from the day after.
export function expiryOf(expiresAt: Date | null, today: string) {
  if (expiresAt === null) return LotStatus.OK;

  const day = toDateString(expiresAt);

  if (day < today) return LotStatus.EXPIRED;
  if (day <= addDays(today, EXPIRING_SOON_DAYS)) return LotStatus.EXPIRING_SOON;

  return LotStatus.OK;
}

export function lotStatusOf(lot: Lot, today: string) {
  return lot.quantity.gt(0) ? expiryOf(lot.expiresAt, today) : LotStatus.DEPLETED;
}

export function statusOf({ quantity, minimumQuantity }: StockBalance, lots: Lot[], today: string) {
  if (quantity.lt(0)) return StockStatus.NEGATIVE;
  if (quantity.eq(0)) return StockStatus.EMPTY;

  const expiries = held(lots).map((lot) => expiryOf(lot.expiresAt, today));

  if (expiries.includes(LotStatus.EXPIRED)) return StockStatus.EXPIRED;
  if (expiries.includes(LotStatus.EXPIRING_SOON)) return StockStatus.EXPIRING_SOON;
  if (minimumQuantity !== null && quantity.lt(minimumQuantity)) return StockStatus.BELOW_MINIMUM;

  return StockStatus.OK;
}

// What is left of a lot at what that lot cost, in cents.
export function lotValueOf({ quantity, unitCost }: Lot): Prisma.Decimal {
  return quantity.gt(0) ? quantity.mul(unitCost).toDecimalPlaces(2) : ZERO;
}

// Each lot is rounded before adding up, so the lots shown for a product add up to what it is worth.
export function valueOf(lots: Lot[]): Prisma.Decimal {
  return Prisma.Decimal.sum(ZERO, ...lots.map(lotValueOf));
}

export function lotCountOf(lots: Lot[]): number {
  return held(lots).length;
}

// The earliest day a lot still held expires on. Null when none of them ever does.
export function nextExpiryOf(lots: Lot[]): string | null {
  const days = held(lots)
    .flatMap((lot) => (lot.expiresAt === null ? [] : [toDateString(lot.expiresAt)]))
    .sort();

  return days[0] ?? null;
}
