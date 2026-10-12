import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { resetDatabase, testPrisma } from "../support/database.js";

const MIGRATIONS = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));

// The statement that turns the balances that existed before lots into lots. It ran once, when the
// migration was applied to an empty test schema; running it again here is what puts it under test.
function backfillStatement(): string {
  const folder = readdirSync(MIGRATIONS).find((name) => name.endsWith("_add_stock_lots"));
  const sql = readFileSync(`${MIGRATIONS}/${folder}/migration.sql`, "utf8");
  const statement = /-- Backfill\n([\s\S]*?;)/.exec(sql);

  expect(statement).not.toBeNull();

  return statement![1];
}

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createProductWithStock = async (description: string, stock: Record<string, string>) => {
  const product = await testPrisma.product.create({ data: { description, kind: "GOODS", unit: "KILOGRAM" } });
  await testPrisma.productStock.create({ data: { productSku: product.sku, ...stock } });

  return product;
};

describe("stock lots backfill", () => {
  it("turns each positive balance into one lot that never expires, at the average cost", async () => {
    const flour = await createProductWithStock("Flour", { quantity: "10.5", averageCost: "4.25", lastEntryCost: "5" });

    await testPrisma.$executeRawUnsafe(backfillStatement());

    const lots = await testPrisma.stockLot.findMany();

    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ productSku: flour.sku, expiresAt: null, supplierId: null });
    expect(lots[0].initialQuantity.toString()).toBe("10.5");
    expect(lots[0].quantity.toString()).toBe("10.5");
    expect(lots[0].unitCost.toString()).toBe("4.25");
  });

  it("opens no lot for a balance that is zero or negative", async () => {
    await createProductWithStock("Yeast", { quantity: "0", averageCost: "4" });
    await createProductWithStock("Salt", { quantity: "-3", averageCost: "4" });

    await testPrisma.$executeRawUnsafe(backfillStatement());

    expect(await testPrisma.stockLot.count()).toBe(0);
  });

  it("opens the lot at no cost for a balance that never had one", async () => {
    await createProductWithStock("Sugar", { quantity: "2" });

    await testPrisma.$executeRawUnsafe(backfillStatement());

    expect((await testPrisma.stockLot.findFirstOrThrow()).unitCost.toString()).toBe("0");
  });
});
