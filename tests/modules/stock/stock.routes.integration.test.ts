import { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Permission, StockMovementType } from "../../../src/generated/prisma/index.js";
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
          createdBy: { id: userId, name: "Test Person" },
        },
        expect.objectContaining({ id: entry.id, type: "ENTRY" }),
      ],
      nextCursor: null,
    });
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

const createStock = (productSku: string, data: Record<string, string>) =>
  testPrisma.productStock.create({ data: { productSku, ...data } });

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
          status: "OK",
        },
        {
          product: { sku: yeast.sku, description: "Yeast", unit: "KILOGRAM" },
          quantity: "2",
          minimumQuantity: null,
          lastEntryCost: "30",
          averageCost: "30.005",
          value: "60.01",
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
});
