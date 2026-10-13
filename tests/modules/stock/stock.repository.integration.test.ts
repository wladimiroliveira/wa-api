import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Prisma } from "../../../src/generated/prisma/index.js";
import { lockStockBalance, takeFromLot, takeFromLots } from "../../../src/modules/stock/stock.repository.js";
import { resetDatabase, testPrisma } from "../../support/database.js";

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

// Resolves once some transaction of this database is waiting for a lock another one holds.
async function someoneWaitsForALock() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const [{ waiting }] = await testPrisma.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `;

    if (waiting > 0) return;

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error("Nobody ended up waiting for a lock.");
}

describe("taking from the lots of one product at the same time", () => {
  it("lets a write-off of one lot wait for a consumption already under way, instead of deadlocking with it", async () => {
    const product = await testPrisma.product.create({
      data: { description: "Wheat flour", kind: "GOODS", unit: "KILOGRAM" },
    });
    await testPrisma.productStock.create({
      data: { productSku: product.sku, quantity: "10", averageCost: "4", lastEntryCost: "4" },
    });
    const lot = await testPrisma.stockLot.create({
      data: { productSku: product.sku, quantity: "10", initialQuantity: "10", unitCost: "4" },
    });

    let consumptionHoldsTheBalance = () => {};
    const balanceHeld = new Promise<void>((resolve) => {
      consumptionHoldsTheBalance = resolve;
    });

    // The consumption is caught between its two steps: it holds the balance and has yet to reach
    // the lots when the write-off arrives.
    const consumption = testPrisma.$transaction(async (tx) => {
      await lockStockBalance(tx, product.sku);
      consumptionHoldsTheBalance();
      await someoneWaitsForALock();

      return takeFromLots(tx, { productSku: product.sku, quantity: new Prisma.Decimal(3), today: "2026-01-01" });
    });
    const writeOff = balanceHeld.then(() =>
      testPrisma.$transaction((tx) => takeFromLot(tx, { lotId: lot.id, quantity: new Prisma.Decimal(2) })),
    );

    const [consumed, writtenOff] = await Promise.allSettled([consumption, writeOff]);

    expect(consumed).toMatchObject({ status: "fulfilled" });
    expect(writtenOff).toMatchObject({ status: "fulfilled" });
    expect((await testPrisma.stockLot.findUniqueOrThrow({ where: { id: lot.id } })).quantity.toString()).toBe("5");
    expect(
      (await testPrisma.productStock.findUniqueOrThrow({ where: { productSku: product.sku } })).quantity.toString(),
    ).toBe("5");
  });
});

describe("taking more than the lots of a product cover", () => {
  it("costs what is owed at the last entry cost when the product never had a lot", async () => {
    const product = await testPrisma.product.create({
      data: { description: "Wheat flour", kind: "GOODS", unit: "KILOGRAM" },
    });
    // A balance that went negative before there were lots: nothing was left to turn into one.
    await testPrisma.productStock.create({
      data: { productSku: product.sku, quantity: "-2", averageCost: "4", lastEntryCost: "4.5" },
    });

    const taken = await testPrisma.$transaction((tx) =>
      takeFromLots(tx, { productSku: product.sku, quantity: new Prisma.Decimal(3), today: "2026-01-01" }),
    );

    expect(
      taken.map((take) => ({ ...take, quantity: take.quantity.toString(), unitCost: take.unitCost.toString() })),
    ).toEqual([{ lotId: null, quantity: "3", unitCost: "4.5" }]);
    expect(
      (await testPrisma.productStock.findUniqueOrThrow({ where: { productSku: product.sku } })).quantity.toString(),
    ).toBe("-5");
  });
});
