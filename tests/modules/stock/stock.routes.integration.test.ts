import { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Permission, Prisma, StockMovementType } from "../../../src/generated/prisma/index.js";
import { takeFromLots } from "../../../src/modules/stock/stock.repository.js";
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

const createProduct = (description = "Wheat flour") =>
  testPrisma.product.create({ data: { description, kind: "GOODS", unit: "KILOGRAM" } });

// Each movement is a minute newer than the one before, so the order under test is never a tie.
let minute = 0;

const createMovement = (input: { productSku: string; createdById: string; type?: StockMovementType }) =>
  testPrisma.stockMovement.create({
    data: {
      type: "ENTRY",
      quantity: "10.5",
      unitCost: "4",
      createdAt: new Date(Date.UTC(2026, 9, 1, 12, minute++)),
      ...input,
    },
  });

const listMovements = (headers: { authorization: string } | undefined, query: Record<string, string> = {}) =>
  app.inject({ method: "GET", url: "/v1/stock-movements", headers, query });

describe("GET /v1/stock-movements", () => {
  it("lists the movements, the newest first, with the product and who recorded each", async () => {
    const { headers, userId } = await authenticateAs(app, [Permission.ENTRIES_READ]);
    const product = await createProduct();
    const entry = await createMovement({ productSku: product.sku, createdById: userId });
    const consumption = await createMovement({
      productSku: product.sku,
      createdById: userId,
      type: "PRODUCTION_CONSUMPTION",
    });

    const response = await listMovements(headers);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          id: consumption.id,
          type: "PRODUCTION_CONSUMPTION",
          quantity: "10.5",
          unitCost: "4",
          createdAt: consumption.createdAt.toISOString(),
          product: { sku: product.sku, description: "Wheat flour", unit: "KILOGRAM" },
          lot: null,
          createdBy: { id: userId, name: "Test Person" },
        },
        expect.objectContaining({ id: entry.id, type: "ENTRY" }),
      ],
      nextCursor: null,
    });
  });

  it("tells the lot a movement moved, with its expiry date and supplier", async () => {
    const { headers, userId } = await authenticateAs(app, [Permission.ENTRIES_READ]);
    const product = await createProduct();
    const supplier = await testPrisma.supplier.create({ data: { name: "Santa Clara Mill" } });
    const dated = await testPrisma.stockLot.create({
      data: {
        productSku: product.sku,
        supplierId: supplier.id,
        quantity: "10",
        initialQuantity: "10",
        unitCost: "4",
        expiresAt: new Date("2099-12-31"),
      },
    });
    const undated = await testPrisma.stockLot.create({
      data: { productSku: product.sku, quantity: "10", initialQuantity: "10", unitCost: "4" },
    });
    await testPrisma.stockMovement.create({
      data: {
        productSku: product.sku,
        createdById: userId,
        type: "ENTRY",
        quantity: "10",
        unitCost: "4",
        lotId: dated.id,
        createdAt: new Date("2026-10-01T12:00:00Z"),
      },
    });
    await testPrisma.stockMovement.create({
      data: {
        productSku: product.sku,
        createdById: userId,
        type: "ENTRY",
        quantity: "10",
        unitCost: "4",
        lotId: undated.id,
        createdAt: new Date("2026-10-01T11:00:00Z"),
      },
    });

    const lots = (await listMovements(headers)).json().items.map(({ lot }: { lot: unknown }) => lot);

    expect(lots).toEqual([
      { id: dated.id, expiresAt: "2099-12-31", supplier: { id: supplier.id, name: "Santa Clara Mill" } },
      { id: undated.id, expiresAt: null, supplier: null },
    ]);
  });

  it("answers an empty page when nothing has moved", async () => {
    const { headers } = await authenticateAs(app, [Permission.ENTRIES_READ]);

    expect((await listMovements(headers)).json()).toEqual({ items: [], nextCursor: null });
  });

  it("lists only the movements of the product asked for", async () => {
    const { headers, userId } = await authenticateAs(app, [Permission.ENTRIES_READ]);
    const flour = await createProduct();
    const yeast = await createProduct("Yeast");
    await createMovement({ productSku: flour.sku, createdById: userId });
    const ofYeast = await createMovement({ productSku: yeast.sku, createdById: userId });

    const response = await listMovements(headers, { productSku: yeast.sku });

    expect(response.json().items.map(({ id }: { id: string }) => id)).toEqual([ofYeast.id]);
  });

  it("hands the list out in pages, and the product filter holds across them", async () => {
    const { headers, userId } = await authenticateAs(app, [Permission.ENTRIES_READ]);
    const flour = await createProduct();
    const yeast = await createProduct("Yeast");
    const first = await createMovement({ productSku: flour.sku, createdById: userId });
    await createMovement({ productSku: yeast.sku, createdById: userId });
    const second = await createMovement({ productSku: flour.sku, createdById: userId });
    const third = await createMovement({ productSku: flour.sku, createdById: userId });

    const page = await listMovements(headers, { productSku: flour.sku, limit: "2" });

    expect(page.json().items.map(({ id }: { id: string }) => id)).toEqual([third.id, second.id]);
    expect(page.json().nextCursor).toBe(second.id);

    const next = await listMovements(headers, { productSku: flour.sku, limit: "2", cursor: page.json().nextCursor });

    expect(next.json().items.map(({ id }: { id: string }) => id)).toEqual([first.id]);
    expect(next.json().nextCursor).toBeNull();
  });

  it.each([
    ["a zero limit", { limit: "0" }],
    ["a limit above a hundred", { limit: "101" }],
    ["a cursor that is not an id", { cursor: "next" }],
    ["a product that is not a sku", { productSku: "flour" }],
  ])("answers 400 for %s", async (_label, query) => {
    const { headers } = await authenticateAs(app, [Permission.ENTRIES_READ]);

    expect((await listMovements(headers, query)).statusCode).toBe(400);
  });

  it("answers 403 without ENTRIES_READ", async () => {
    const { headers } = await authenticateAs(app, [Permission.ENTRIES_CREATE]);

    expect((await listMovements(headers)).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await listMovements(undefined)).statusCode).toBe(401);
  });
});

const getStock = (headers: { authorization: string } | undefined) =>
  app.inject({ method: "GET", url: "/v1/stock", headers });

// A balance above zero is held in lots, so the stock is given one lot holding all of it.
const createStock = async (productSku: string, data: Record<string, string>, expiresAt: string | null = null) => {
  await testPrisma.productStock.create({ data: { productSku, ...data } });

  if (Number(data.quantity) > 0)
    await createLot(productSku, { quantity: data.quantity, unitCost: data.averageCost, expiresAt });
};

const createLot = (
  productSku: string,
  lot: {
    quantity: string;
    unitCost?: string;
    expiresAt?: string | null;
    initialQuantity?: string;
    supplierId?: string;
  },
) =>
  testPrisma.stockLot.create({
    data: {
      productSku,
      supplierId: lot.supplierId,
      initialQuantity: lot.initialQuantity ?? lot.quantity,
      quantity: lot.quantity,
      unitCost: lot.unitCost ?? "0",
      expiresAt: lot.expiresAt == null ? null : new Date(lot.expiresAt),
    },
  });

const daysFromToday = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

describe("GET /v1/stock", () => {
  it("lists the position of every product by description, and what the stock is worth", async () => {
    const { headers } = await authenticateAs(app, [Permission.REPORTS_READ]);
    const yeast = await createProduct("Yeast");
    const flour = await createProduct("Flour");
    await createStock(flour.sku, { quantity: "10.5", lastEntryCost: "4.5", averageCost: "4.25", minimumQuantity: "5" });
    await createStock(yeast.sku, { quantity: "2", lastEntryCost: "30", averageCost: "30.005" });

    const response = await getStock(headers);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          product: { sku: flour.sku, description: "Flour", unit: "KILOGRAM" },
          quantity: "10.5",
          minimumQuantity: "5",
          lastEntryCost: "4.5",
          averageCost: "4.25",
          value: "44.63",
          lotCount: 1,
          nextExpiresAt: null,
          status: "OK",
        },
        {
          product: { sku: yeast.sku, description: "Yeast", unit: "KILOGRAM" },
          quantity: "2",
          minimumQuantity: null,
          lastEntryCost: "30",
          averageCost: "30.005",
          value: "60.01",
          lotCount: 1,
          nextExpiresAt: null,
          status: "OK",
        },
      ],
      totalValue: "104.64",
    });
  });

  it("lists a product that never moved as empty and worth nothing", async () => {
    const { headers } = await authenticateAs(app, [Permission.REPORTS_READ]);
    const flour = await createProduct("Flour");

    expect((await getStock(headers)).json()).toEqual({
      items: [
        {
          product: { sku: flour.sku, description: "Flour", unit: "KILOGRAM" },
          quantity: "0",
          minimumQuantity: null,
          lastEntryCost: null,
          averageCost: null,
          value: "0.00",
          lotCount: 0,
          nextExpiresAt: null,
          status: "EMPTY",
        },
      ],
      totalValue: "0.00",
    });
  });

  it.each([
    ["a negative balance", { quantity: "-3", averageCost: "4" }, "NEGATIVE", "0.00"],
    ["a zero balance", { quantity: "0", averageCost: "4", minimumQuantity: "5" }, "EMPTY", "0.00"],
    [
      "a balance under the minimum",
      { quantity: "4.999", averageCost: "4", minimumQuantity: "5" },
      "BELOW_MINIMUM",
      "20.00",
    ],
    ["a balance exactly at the minimum", { quantity: "5", averageCost: "4", minimumQuantity: "5" }, "OK", "20.00"],
  ])("reads %s as such", async (_label, stock, status, value) => {
    const { headers } = await authenticateAs(app, [Permission.REPORTS_READ]);
    const flour = await createProduct("Flour");
    await createStock(flour.sku, stock);

    const response = await getStock(headers);

    expect(response.json().items[0]).toMatchObject({ status, value });
    expect(response.json().totalValue).toBe(value);
  });

  it("answers an empty position when the catalog is empty", async () => {
    const { headers } = await authenticateAs(app, [Permission.REPORTS_READ]);

    expect((await getStock(headers)).json()).toEqual({ items: [], totalValue: "0.00" });
  });

  it("answers 403 without REPORTS_READ", async () => {
    const { headers } = await authenticateAs(app, [Permission.ENTRIES_READ]);

    expect((await getStock(headers)).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await getStock(undefined)).statusCode).toBe(401);
  });

  it("values the stock at what each lot cost, and tells the lots still held and the next to expire", async () => {
    const { headers } = await authenticateAs(app, [Permission.REPORTS_READ]);
    const flour = await createProduct("Flour");
    await testPrisma.productStock.create({ data: { productSku: flour.sku, quantity: "5", averageCost: "5" } });
    await createLot(flour.sku, { quantity: "2", unitCost: "4", expiresAt: daysFromToday(90) });
    await createLot(flour.sku, { quantity: "3", unitCost: "6", expiresAt: daysFromToday(60) });
    await createLot(flour.sku, { quantity: "0", unitCost: "9", expiresAt: daysFromToday(40), initialQuantity: "7" });
    await createLot(flour.sku, { quantity: "0", unitCost: "9", initialQuantity: "1" });

    const [item] = (await getStock(headers)).json().items;

    expect(item).toMatchObject({ value: "26.00", lotCount: 2, nextExpiresAt: daysFromToday(60), status: "OK" });
  });

  it.each([
    ["a product holding an expired lot", -1, "EXPIRED"],
    ["a product holding a lot about to expire", 30, "EXPIRING_SOON"],
    ["a product whose lots expire later", 31, "OK"],
  ])("reads %s as such", async (_label, days, status) => {
    const { headers } = await authenticateAs(app, [Permission.REPORTS_READ]);
    const flour = await createProduct("Flour");
    await createStock(flour.sku, { quantity: "5", averageCost: "4" }, daysFromToday(days));

    expect((await getStock(headers)).json().items[0].status).toBe(status);
  });
});

const getProductStock = (
  headers: { authorization: string } | undefined,
  sku: string,
  query: Record<string, string> = {},
) => app.inject({ method: "GET", url: `/v1/stock/${sku}`, headers, query });

describe("GET /v1/stock/:sku", () => {
  it("details the position of a product and the lots it still holds, the first to expire first", async () => {
    const { headers } = await authenticateAs(app, [Permission.REPORTS_READ]);
    const flour = await createProduct("Flour");
    const mill = await testPrisma.supplier.create({ data: { name: "Santa Clara Mill" } });
    await testPrisma.productStock.create({
      data: { productSku: flour.sku, quantity: "6", averageCost: "5", lastEntryCost: "6", minimumQuantity: "2" },
    });
    const never = await createLot(flour.sku, { quantity: "1", unitCost: "2" });
    const later = await createLot(flour.sku, { quantity: "2", unitCost: "4", expiresAt: daysFromToday(90) });
    const sooner = await createLot(flour.sku, {
      quantity: "3",
      unitCost: "6",
      expiresAt: daysFromToday(10),
      initialQuantity: "8",
      supplierId: mill.id,
    });
    await createLot(flour.sku, { quantity: "0", unitCost: "9", expiresAt: daysFromToday(5), initialQuantity: "7" });

    const response = await getProductStock(headers, flour.sku);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      product: { sku: flour.sku, description: "Flour", unit: "KILOGRAM" },
      quantity: "6",
      minimumQuantity: "2",
      lastEntryCost: "6",
      averageCost: "5",
      value: "28.00",
      lotCount: 3,
      nextExpiresAt: daysFromToday(10),
      status: "EXPIRING_SOON",
      lots: [
        {
          id: sooner.id,
          expiresAt: daysFromToday(10),
          supplier: { id: mill.id, name: "Santa Clara Mill" },
          initialQuantity: "8",
          quantity: "3",
          unitCost: "6",
          value: "18.00",
          createdAt: sooner.createdAt.toISOString(),
          status: "EXPIRING_SOON",
        },
        expect.objectContaining({ id: later.id, expiresAt: daysFromToday(90), supplier: null, status: "OK" }),
        expect.objectContaining({ id: never.id, expiresAt: null, value: "2.00", status: "OK" }),
      ],
    });
  });

  it("puts the lot that came in first ahead of another that expires on the same day", async () => {
    const { headers } = await authenticateAs(app, [Permission.REPORTS_READ]);
    const flour = await createProduct("Flour");
    const first = await createLot(flour.sku, { quantity: "1", expiresAt: daysFromToday(90) });
    const second = await createLot(flour.sku, { quantity: "1", expiresAt: daysFromToday(90) });

    const { lots } = (await getProductStock(headers, flour.sku)).json();

    expect(lots.map(({ id }: { id: string }) => id)).toEqual([first.id, second.id]);
  });

  it("includes the lots with nothing left when asked for them", async () => {
    const { headers } = await authenticateAs(app, [Permission.REPORTS_READ]);
    const flour = await createProduct("Flour");
    const depleted = await createLot(flour.sku, { quantity: "0", expiresAt: daysFromToday(-5), initialQuantity: "7" });

    const response = await getProductStock(headers, flour.sku, { depleted: "true" });

    expect(response.json().lots).toEqual([expect.objectContaining({ id: depleted.id, status: "DEPLETED" })]);
    expect(response.json().status).toBe("EMPTY");
  });

  it("details a product that never moved as empty, with no lots", async () => {
    const { headers } = await authenticateAs(app, [Permission.REPORTS_READ]);
    const flour = await createProduct("Flour");

    expect((await getProductStock(headers, flour.sku)).json()).toMatchObject({
      quantity: "0",
      status: "EMPTY",
      lots: [],
    });
  });

  it("answers 404 for a product that does not exist", async () => {
    const { headers } = await authenticateAs(app, [Permission.REPORTS_READ]);

    expect((await getProductStock(headers, "0199a1f0-0000-7000-8000-0000000000ff")).statusCode).toBe(404);
  });

  it.each([
    ["a product that is not a sku", "flour", {}],
    [
      "an unknown answer to whether depleted lots are wanted",
      "0199a1f0-0000-7000-8000-0000000000ff",
      { depleted: "maybe" },
    ],
  ])("answers 400 for %s", async (_label, sku, query) => {
    const { headers } = await authenticateAs(app, [Permission.REPORTS_READ]);

    expect((await getProductStock(headers, sku, query)).statusCode).toBe(400);
  });

  it("answers 403 without REPORTS_READ", async () => {
    const { headers } = await authenticateAs(app, [Permission.ENTRIES_READ]);

    expect((await getProductStock(headers, "0199a1f0-0000-7000-8000-0000000000ff")).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await getProductStock(undefined, "0199a1f0-0000-7000-8000-0000000000ff")).statusCode).toBe(401);
  });
});

describe("a product whose only lot expired and whose balance was consumed anyway", () => {
  it("still reads as holding an expired lot", async () => {
    const { headers } = await authenticateAs(app, [Permission.REPORTS_READ]);
    const flour = await createProduct("Flour");
    await createStock(flour.sku, { quantity: "5", averageCost: "4" }, daysFromToday(-1));

    // A production takes 5: the expired lot is skipped, so all of it stays owed.
    await testPrisma.$transaction((tx) =>
      takeFromLots(tx, { productSku: flour.sku, quantity: new Prisma.Decimal(5), today: daysFromToday(0) }),
    );

    const [item] = (await getStock(headers)).json().items;

    expect({ quantity: item.quantity, lotCount: item.lotCount, nextExpiresAt: item.nextExpiresAt }).toEqual({
      quantity: "0",
      lotCount: 1,
      nextExpiresAt: daysFromToday(-1),
    });
    expect(item.status).toBe("EXPIRED");
  });
});
