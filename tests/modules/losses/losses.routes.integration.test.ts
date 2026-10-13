import { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Permission } from "../../../src/generated/prisma/index.js";
import { authenticateAs, startTestApp } from "../../support/app.js";
import { resetDatabase, testPrisma } from "../../support/database.js";

let app: FastifyInstance;

beforeEach(async () => {
  app = await startTestApp();
});

afterEach(async () => {
  await app.close();
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

type Headers = { authorization: string } | undefined;

const MISSING_ID = "0199a1f0-0000-7000-8000-0000000000ff";

const postLoss = (headers: Headers, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/losses", headers, payload });

const canRegister = () => authenticateAs(app, [Permission.LOSSES_CREATE]);

// 10 kg of flour at 4.00 in a single lot, and a reason to write some of it off.
async function flourInStock({ expiresAt = null as string | null, reasonIsActive = true } = {}) {
  const product = await testPrisma.product.create({
    data: { description: "Wheat flour", kind: "GOODS", unit: "KILOGRAM" },
  });
  await testPrisma.productStock.create({
    data: { productSku: product.sku, quantity: "10", averageCost: "4", lastEntryCost: "4" },
  });
  const lot = await testPrisma.stockLot.create({
    data: {
      productSku: product.sku,
      quantity: "10",
      initialQuantity: "10",
      unitCost: "4",
      expiresAt: expiresAt === null ? null : new Date(expiresAt),
    },
  });
  const reason = await testPrisma.lossReason.create({ data: { name: "Expiry", isActive: reasonIsActive } });

  return { product, lot, reason };
}

const lotQuantity = async (id: string) =>
  (await testPrisma.stockLot.findUniqueOrThrow({ where: { id } })).quantity.toString();

const balanceOf = async (productSku: string) =>
  (await testPrisma.productStock.findUniqueOrThrow({ where: { productSku } })).quantity.toString();

describe("POST /v1/losses", () => {
  it("writes the quantity off the lot and the balance, and records why", async () => {
    const { headers, userId } = await canRegister();
    const { product, lot, reason } = await flourInStock({ expiresAt: "2099-12-31" });

    const response = await postLoss(headers, {
      lotId: lot.id,
      reasonId: reason.id,
      quantity: "2.5",
      note: "  Torn bag.  ",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: expect.any(String),
      quantity: "2.5",
      unitCost: "4",
      note: "Torn bag.",
      createdAt: expect.any(String),
      reason: { id: reason.id, name: "Expiry" },
      product: { sku: product.sku, description: "Wheat flour", unit: "KILOGRAM" },
      lot: { id: lot.id, expiresAt: "2099-12-31", quantity: "7.5" },
    });

    expect(await lotQuantity(lot.id)).toBe("7.5");
    expect(await balanceOf(product.sku)).toBe("7.5");

    const loss = await testPrisma.stockLoss.findUniqueOrThrow({ where: { id: response.json().id } });

    expect(loss).toMatchObject({ lotId: lot.id, reasonId: reason.id, createdById: userId, note: "Torn bag." });

    const movement = await testPrisma.stockMovement.findFirstOrThrow();

    expect(movement).toMatchObject({ type: "LOSS", productSku: product.sku, lotId: lot.id, createdById: userId });
    expect(movement.quantity.toString()).toBe("2.5");
    expect(movement.unitCost.toString()).toBe("4");
    expect(loss.movementId).toBe(movement.id);
  });

  it("answers the quantity as it was recorded, not as it was typed", async () => {
    const { headers } = await canRegister();
    const { lot, reason } = await flourInStock();

    const response = await postLoss(headers, { lotId: lot.id, reasonId: reason.id, quantity: "2.50" });

    expect(response.statusCode).toBe(201);
    expect(response.json().quantity).toBe("2.5");
  });

  it("writes off a lot that has already expired, all of it", async () => {
    const { headers } = await canRegister();
    const { lot, reason } = await flourInStock({ expiresAt: "2020-01-01" });

    const response = await postLoss(headers, { lotId: lot.id, reasonId: reason.id, quantity: "10" });

    expect(response.statusCode).toBe(201);
    expect(response.json().note).toBeNull();
    expect(await lotQuantity(lot.id)).toBe("0");
  });

  it("leaves the average cost of the product as it was", async () => {
    const { headers } = await canRegister();
    const { product, lot, reason } = await flourInStock();

    await postLoss(headers, { lotId: lot.id, reasonId: reason.id, quantity: "1" });

    const stock = await testPrisma.productStock.findUniqueOrThrow({ where: { productSku: product.sku } });

    expect(stock.averageCost?.toString()).toBe("4");
  });

  it("answers 409 for more than the lot holds, and writes nothing", async () => {
    const { headers } = await canRegister();
    const { product, lot, reason } = await flourInStock();

    const response = await postLoss(headers, { lotId: lot.id, reasonId: reason.id, quantity: "10.000001" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "The lot does not hold that much." });
    expect(await lotQuantity(lot.id)).toBe("10");
    expect(await balanceOf(product.sku)).toBe("10");
    expect(await testPrisma.stockLoss.count()).toBe(0);
    expect(await testPrisma.stockMovement.count()).toBe(0);
  });

  it("never writes off more than the lot holds when several losses arrive at once", async () => {
    const { headers } = await canRegister();
    const { lot, reason } = await flourInStock();

    const responses = await Promise.all(
      Array.from({ length: 6 }, () => postLoss(headers, { lotId: lot.id, reasonId: reason.id, quantity: "4" })),
    );

    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 201, 409, 409, 409, 409]);
    expect(await lotQuantity(lot.id)).toBe("2");
  });

  it("answers 409 for a reason that is no longer in use, and writes nothing", async () => {
    const { headers } = await canRegister();
    const { product, lot, reason } = await flourInStock({ reasonIsActive: false });

    const response = await postLoss(headers, { lotId: lot.id, reasonId: reason.id, quantity: "1" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "Loss reason is inactive." });
    expect(await lotQuantity(lot.id)).toBe("10");
    expect(await balanceOf(product.sku)).toBe("10");
    expect(await testPrisma.stockMovement.count()).toBe(0);
  });

  it("answers 409 when the reason is put out of use while the loss waits for the stock", async () => {
    const { headers } = await canRegister();
    const { product, lot, reason } = await flourInStock();

    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = () => {};
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });

    // Something else holds the balance of the product, as a consumption under way would.
    const other = testPrisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM product_stocks WHERE product_sku = ${product.sku}::uuid FOR UPDATE`;
      held();
      await released;
    });
    await holding;

    const pending = postLoss(headers, { lotId: lot.id, reasonId: reason.id, quantity: "1" });

    for (let attempt = 0; ; attempt++) {
      const [{ waiting }] = await testPrisma.$queryRaw<{ waiting: number }[]>`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
      `;

      if (waiting > 0) break;
      if (attempt === 100) throw new Error("The loss never got to wait for the stock.");

      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await testPrisma.lossReason.update({ where: { id: reason.id }, data: { isActive: false } });
    release();
    await other;

    const response = await pending;

    expect({ status: response.statusCode, lossesRecorded: await testPrisma.stockLoss.count() }).toEqual({
      status: 409,
      lossesRecorded: 0,
    });
  });

  it("answers 404 for a lot or a reason that does not exist", async () => {
    const { headers } = await canRegister();
    const { lot, reason } = await flourInStock();

    expect((await postLoss(headers, { lotId: MISSING_ID, reasonId: reason.id, quantity: "1" })).json()).toEqual({
      message: "Lot not found.",
    });
    expect((await postLoss(headers, { lotId: lot.id, reasonId: MISSING_ID, quantity: "1" })).json()).toEqual({
      message: "Loss reason not found.",
    });
    expect((await postLoss(headers, { lotId: lot.id, reasonId: MISSING_ID, quantity: "1" })).statusCode).toBe(404);
  });

  it.each([
    ["a zero quantity", { quantity: "0" }],
    ["a quantity that is not a decimal", { quantity: "some" }],
    ["a missing quantity", { quantity: undefined }],
    ["a lot that is not an id", { lotId: "lot" }],
    ["a reason that is not an id", { reasonId: "expiry" }],
    ["a note longer than 300 characters", { note: "x".repeat(301) }],
  ])("answers 400 for %s", async (_label, overrides) => {
    const { headers } = await canRegister();
    const { lot, reason } = await flourInStock();

    const response = await postLoss(headers, { lotId: lot.id, reasonId: reason.id, quantity: "1", ...overrides });

    expect(response.statusCode).toBe(400);
  });

  it("answers 403 without LOSSES_CREATE", async () => {
    const { headers } = await authenticateAs(app, [Permission.LOSSES_UPDATE]);
    const { lot, reason } = await flourInStock();

    expect((await postLoss(headers, { lotId: lot.id, reasonId: reason.id, quantity: "1" })).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await postLoss(undefined, { lotId: MISSING_ID, reasonId: MISSING_ID, quantity: "1" })).statusCode).toBe(
      401,
    );
  });
});
