import { Prisma } from "../../generated/prisma/index.js";
import { pageArgs } from "../../lib/pagination.js";
import { prisma } from "../../lib/prisma.js";
import { allocate } from "./stock.allocation.js";

const ZERO = new Prisma.Decimal(0);

type StockAfterIncrease = { quantity: Prisma.Decimal; lastEntryCost: Prisma.Decimal; averageCost: Prisma.Decimal };

// The balance is updated by a single statement, so the database computes the new average under the
// row lock: reading the stock first and writing it back would let two simultaneous movements
// overwrite each other.
export function increaseStock(
  client: Prisma.TransactionClient,
  input: { productSku: string; quantity: string; unitCost: string },
) {
  return client.$queryRaw<StockAfterIncrease[]>`
    INSERT INTO product_stocks AS stock (product_sku, quantity, last_entry_cost, average_cost, updated_at)
    VALUES (${input.productSku}::uuid, ${input.quantity}::numeric, ${input.unitCost}::numeric, ${input.unitCost}::numeric, now())
    ON CONFLICT (product_sku) DO UPDATE SET
      quantity = stock.quantity + EXCLUDED.quantity,
      last_entry_cost = EXCLUDED.last_entry_cost,
      -- A balance at or below zero has no cost left to weight, so the average restarts from the entry.
      average_cost = CASE
        WHEN stock.quantity <= 0 OR stock.average_cost IS NULL THEN EXCLUDED.last_entry_cost
        ELSE (stock.quantity * stock.average_cost + EXCLUDED.quantity * EXCLUDED.last_entry_cost)
          / (stock.quantity + EXCLUDED.quantity)
      END,
      updated_at = now()
    RETURNING quantity, last_entry_cost AS "lastEntryCost", average_cost AS "averageCost"
  `;
}

// Reads the balance of a product and holds it until the transaction ends, so whatever is decided
// from it is still true when it is written. `owed` is what was taken beyond what the lots held and
// is still to be settled: the lots that are left hold that much more than the balance shows.
export async function lockStockBalance(client: Prisma.TransactionClient, productSku: string) {
  // A product that never moved has no row to hold, and two first movements at once would each read
  // the other's lot against a balance that is not there yet. Opening the row first gives them one.
  await client.$executeRaw`
    INSERT INTO product_stocks (product_sku, quantity, updated_at)
    VALUES (${productSku}::uuid, 0, now())
    ON CONFLICT (product_sku) DO NOTHING
  `;

  const [balance] = await client.$queryRaw<{ quantity: Prisma.Decimal; lastEntryCost: Prisma.Decimal | null }[]>`
    SELECT quantity, last_entry_cost AS "lastEntryCost"
    FROM product_stocks
    WHERE product_sku = ${productSku}::uuid
    FOR UPDATE
  `;
  const { _sum } = await client.stockLot.aggregate({ where: { productSku }, _sum: { quantity: true } });
  const held = _sum.quantity ?? ZERO;
  const quantity = balance?.quantity ?? ZERO;

  return { held, lastEntryCost: balance?.lastEntryCost ?? null, owed: Prisma.Decimal.max(ZERO, held.sub(quantity)) };
}

// Writes off what is owed: the balance becomes what the lots hold.
export function settleStockBalance(client: Prisma.TransactionClient, productSku: string, held: Prisma.Decimal) {
  return client.$executeRaw`
    UPDATE product_stocks SET quantity = ${held}::numeric, updated_at = now() WHERE product_sku = ${productSku}::uuid
  `;
}

// What came into the stock together becomes a lot. `left` is for the lot that comes in already
// partly spoken for; without it the whole quantity is there to take.
export function openLot(
  client: Prisma.TransactionClient,
  lot: {
    productSku: string;
    quantity: Prisma.Decimal | string;
    left?: Prisma.Decimal;
    unitCost: Prisma.Decimal | string;
    expiresAt: string | null;
    supplierId?: string;
  },
) {
  return client.stockLot.create({
    data: {
      productSku: lot.productSku,
      supplierId: lot.supplierId,
      expiresAt: lot.expiresAt === null ? null : new Date(lot.expiresAt),
      initialQuantity: lot.quantity,
      quantity: lot.left ?? lot.quantity,
      unitCost: lot.unitCost,
    },
    select: { id: true, expiresAt: true, quantity: true, supplier: { select: { id: true, name: true } } },
  });
}

type UsableLot = { id: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal; expiresAt: Date | null };

// The lots a quantity may be taken from, in the order they are to be used: the first to expire
// first, the ones that never expire last, and the one that came in earlier ahead of another
// expiring on the same day. An expired lot is not among them: it leaves the stock as a loss, not
// as an input.
function usableLots(
  client: Prisma.TransactionClient,
  { productSku, today, lock }: { productSku: string; today: string; lock: boolean },
) {
  return client.$queryRaw<UsableLot[]>`
    SELECT id, quantity, unit_cost AS "unitCost", expires_at AS "expiresAt"
    FROM stock_lots
    WHERE product_sku = ${productSku}::uuid
      AND quantity > 0
      AND (expires_at IS NULL OR (expires_at AT TIME ZONE 'UTC')::date >= ${today}::date)
    ORDER BY expires_at ASC NULLS LAST, created_at ASC, id ASC
    ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}
  `;
}

// Which lots a quantity would come from if it were taken now, and what they would not cover. It
// takes nothing: by the time the stock really moves, the lots may be others.
export async function suggestLots(input: { productSku: string; quantity: Prisma.Decimal; today: string }) {
  const lots = await usableLots(prisma, { productSku: input.productSku, today: input.today, lock: false });

  return allocate(lots, input.quantity);
}

type Take = { lotId: string | null; quantity: Prisma.Decimal; unitCost: Prisma.Decimal };

// Takes a quantity out of the stock, lot by lot. What the lots do not cover is taken anyway and
// stays owed, costing what the last lot taken from cost.
export async function takeFromLots(
  client: Prisma.TransactionClient,
  input: { productSku: string; quantity: Prisma.Decimal; today: string },
): Promise<Take[]> {
  const { productSku, quantity, today } = input;
  const balance = await lockStockBalance(client, productSku);

  const lots = await usableLots(client, { productSku, today, lock: true });
  const { takes, shortfall } = allocate(lots, quantity);

  for (const { lot, quantity: taken } of takes) {
    await client.stockLot.update({ where: { id: lot.id }, data: { quantity: { decrement: taken } } });
  }

  await decreaseStock(client, { productSku, quantity: quantity.toString() });

  const taken: Take[] = takes.map(({ lot, quantity: amount }) => ({
    lotId: lot.id,
    quantity: amount,
    unitCost: lot.unitCost,
  }));

  if (shortfall.gt(0)) {
    const unitCost =
      taken.at(-1)?.unitCost ?? (await newestLotCost(client, productSku)) ?? balance.lastEntryCost ?? ZERO;

    taken.push({ lotId: null, quantity: shortfall, unitCost });
  }

  return taken;
}

// Takes a quantity out of one given lot, whatever its date: this is how what is expired or damaged
// leaves the stock. Unlike a lot taken from in turn, a lot named outright cannot go short, so more
// than it holds is refused.
type NamedLot = {
  id: string;
  productSku: string;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  expiresAt: Date | null;
};

type LotTake = { failure: "missing" | "insufficient" } | { lot: NamedLot & { left: Prisma.Decimal } };

export async function takeFromLot(
  client: Prisma.TransactionClient,
  { lotId, quantity }: { lotId: string; quantity: Prisma.Decimal },
): Promise<LotTake> {
  const owner = await client.stockLot.findUnique({ where: { id: lotId }, select: { productSku: true } });

  if (owner === null) return { failure: "missing" };

  // Whatever takes from the lots of a product holds its balance first and its lots after. Holding
  // them the other way round here would deadlock with a consumption of the same product.
  await lockStockBalance(client, owner.productSku);

  const [lot] = await client.$queryRaw<NamedLot[]>`
    SELECT id, product_sku AS "productSku", quantity, unit_cost AS "unitCost", expires_at AS "expiresAt"
    FROM stock_lots
    WHERE id = ${lotId}::uuid
    FOR UPDATE
  `;

  if (lot === undefined) return { failure: "missing" };
  if (quantity.gt(lot.quantity)) return { failure: "insufficient" };

  await client.stockLot.update({ where: { id: lotId }, data: { quantity: { decrement: quantity } } });
  await decreaseStock(client, { productSku: lot.productSku, quantity: quantity.toString() });

  return { lot: { ...lot, left: lot.quantity.sub(quantity) } };
}

async function newestLotCost(client: Prisma.TransactionClient, productSku: string) {
  const lot = await client.stockLot.findFirst({
    where: { productSku },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { unitCost: true },
  });

  return lot?.unitCost ?? null;
}

// Taking from the stock never fails for lack of balance: the balance goes negative and the next
// entry settles it. The average cost is what each unit taken is worth, and it stays as it was.
export function decreaseStock(client: Prisma.TransactionClient, input: { productSku: string; quantity: string }) {
  return client.$queryRaw<{ averageCost: Prisma.Decimal | null }[]>`
    INSERT INTO product_stocks AS stock (product_sku, quantity, updated_at)
    VALUES (${input.productSku}::uuid, -${input.quantity}::numeric, now())
    ON CONFLICT (product_sku) DO UPDATE SET
      quantity = stock.quantity + EXCLUDED.quantity,
      updated_at = now()
    RETURNING average_cost AS "averageCost"
  `;
}

export function listStockMovements(query: { productSku?: string; limit: number; cursor?: string }) {
  const { productSku, ...page } = query;

  return prisma.stockMovement.findMany({
    where: { productSku },
    select: {
      id: true,
      type: true,
      quantity: true,
      unitCost: true,
      createdAt: true,
      product: { select: { sku: true, description: true, unit: true } },
      lot: { select: { id: true, expiresAt: true, supplier: { select: { id: true, name: true } } } },
      createdBy: { select: { id: true, name: true } },
    },
    ...pageArgs(page),
  });
}

const STOCK_FIELDS = {
  select: { quantity: true, lastEntryCost: true, averageCost: true, minimumQuantity: true },
} as const;

const STILL_HELD = { quantity: { gt: 0 } } as const;

// Every product, moved or not: one that never had an entry has no stock row yet.
export function listProductsWithStock() {
  return prisma.product.findMany({
    select: {
      sku: true,
      description: true,
      unit: true,
      stock: STOCK_FIELDS,
      lots: { where: STILL_HELD, select: { quantity: true, unitCost: true, expiresAt: true } },
    },
    orderBy: { description: "asc" },
  });
}

// The lots come in the order they are to be used: the first to expire first, the ones that never
// expire last, and the one that came in earlier ahead of another expiring on the same day.
export function findProductWithStock(sku: string, { depleted }: { depleted: boolean }) {
  return prisma.product.findUnique({
    where: { sku },
    select: {
      sku: true,
      description: true,
      unit: true,
      stock: STOCK_FIELDS,
      lots: {
        where: depleted ? {} : STILL_HELD,
        select: {
          id: true,
          expiresAt: true,
          initialQuantity: true,
          quantity: true,
          unitCost: true,
          createdAt: true,
          supplier: { select: { id: true, name: true } },
        },
        orderBy: [{ expiresAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
}
