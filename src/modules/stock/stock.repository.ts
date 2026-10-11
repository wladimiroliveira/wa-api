import { Prisma } from "../../generated/prisma/index.js";

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
