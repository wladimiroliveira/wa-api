import { Prisma, StockMovementType } from "../../generated/prisma/index.js";
import { prisma } from "../../lib/prisma.js";

type StockAfterEntry = { quantity: Prisma.Decimal; lastEntryCost: Prisma.Decimal; averageCost: Prisma.Decimal };

export function findProductBySku(sku: string) {
  return prisma.product.findUnique({
    where: { sku },
    select: { sku: true, description: true, unit: true, isActive: true },
  });
}

// The movement and the balance change together or not at all. The balance is updated by a single
// statement, so the database computes the new average under the row lock: reading the stock first
// and writing it back would let two simultaneous entries overwrite each other.
export async function insertEntry(input: {
  productSku: string;
  quantity: string;
  unitCost: string;
  createdById: string;
}) {
  const [movement, [stock]] = await prisma.$transaction([
    prisma.stockMovement.create({ data: { ...input, type: StockMovementType.ENTRY } }),
    prisma.$queryRaw<StockAfterEntry[]>`
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
    `,
  ]);

  return { movement, stock };
}
