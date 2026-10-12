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
