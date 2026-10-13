import { Prisma } from "../../generated/prisma/index.js";

// Takes a quantity from the lots in the order they are given, emptying each before moving on to
// the next, and tells what they did not cover. Deciding the order is up to whoever lists the lots.
export function allocate<Lot extends { quantity: Prisma.Decimal }>(lots: Lot[], quantity: Prisma.Decimal) {
  const takes: { lot: Lot; quantity: Prisma.Decimal }[] = [];
  let shortfall = quantity;

  for (const lot of lots) {
    if (shortfall.lte(0)) break;

    const taken = Prisma.Decimal.min(lot.quantity, shortfall);

    takes.push({ lot, quantity: taken });
    shortfall = shortfall.sub(taken);
  }

  return { takes, shortfall };
}

type Dated = { id: string; expiresAt: Date | null; createdAt: Date };

// The order the lots of a product are to be used in: the first to expire first, the ones that
// never expire last, and the one that came in earlier ahead of another expiring on the same day.
export function inOrderOfUse<Lot extends Dated>(lots: Lot[]): Lot[] {
  const expiry = (lot: Lot) => lot.expiresAt?.getTime() ?? Infinity;

  return [...lots].sort((a, b) => {
    if (expiry(a) !== expiry(b)) return expiry(a) < expiry(b) ? -1 : 1;
    if (a.createdAt.getTime() !== b.createdAt.getTime()) return a.createdAt.getTime() - b.createdAt.getTime();

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

const ZERO = new Prisma.Decimal(0);

// What was taken beyond what the lots held and is still to be settled: the lots that are left hold
// that much more than the balance shows.
export function owedOf({ held, quantity }: { held: Prisma.Decimal; quantity: Prisma.Decimal }): Prisma.Decimal {
  return Prisma.Decimal.max(ZERO, held.sub(quantity));
}

type Cost = Prisma.Decimal | null;

// What the lots did not cover costs what the last lot taken from cost. With none to take from, it
// costs what the newest lot the product had cost, and what its last entry cost before there were lots.
export function costOfShortfall(known: { lastLotTaken: Cost; newestLot: Cost; lastEntry: Cost }): Prisma.Decimal {
  return known.lastLotTaken ?? known.newestLot ?? known.lastEntry ?? ZERO;
}
