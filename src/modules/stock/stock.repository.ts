import { Prisma } from "../../generated/prisma/index.js";
import { pageArgs } from "../../lib/pagination.js";
import { prisma } from "../../lib/prisma.js";

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
      createdBy: { select: { id: true, name: true } },
    },
    ...pageArgs(page),
  });
}

// Every product, moved or not: one that never had an entry has no stock row yet.
export function listProductsWithStock() {
  return prisma.product.findMany({
    select: {
      sku: true,
      description: true,
      unit: true,
      stock: { select: { quantity: true, lastEntryCost: true, averageCost: true, minimumQuantity: true } },
    },
    orderBy: { description: "asc" },
  });
}
