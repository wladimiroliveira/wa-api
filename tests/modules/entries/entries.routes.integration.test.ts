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

const createProduct = (overrides: { isActive?: boolean } = {}) =>
  testPrisma.product.create({ data: { description: "Wheat flour", kind: "GOODS", unit: "KILOGRAM", ...overrides } });

const postEntry = (headers: { authorization: string } | undefined, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/entries", headers, payload });

const stockOf = (productSku: string) => testPrisma.productStock.findUnique({ where: { productSku } });

describe("POST /v1/entries", () => {
  it("records the movement and opens the stock on a product's first entry", async () => {
    const { headers, userId } = await authenticateAs(app, [Permission.ENTRIES_CREATE]);
    const product = await createProduct();

    const response = await postEntry(headers, { productSku: product.sku, quantity: "10", unitCost: "4.5" });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      type: "ENTRY",
      quantity: "10",
      unitCost: "4.5",
      product: { sku: product.sku, description: "Wheat flour", unit: "KILOGRAM" },
      stock: { quantity: "10", lastEntryCost: "4.5", averageCost: "4.5" },
    });

    const movements = await testPrisma.stockMovement.findMany();

    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ id: response.json().id, productSku: product.sku, createdById: userId });
    expect((await stockOf(product.sku))?.quantity.toString()).toBe("10");
  });

  it("adds to the balance and weights the average cost on the next entry", async () => {
    const { headers } = await authenticateAs(app, [Permission.ENTRIES_CREATE]);
    const product = await createProduct();

    await postEntry(headers, { productSku: product.sku, quantity: "10", unitCost: "4" });
    const response = await postEntry(headers, { productSku: product.sku, quantity: "30", unitCost: "6" });

    expect(response.json().stock).toEqual({ quantity: "40", lastEntryCost: "6", averageCost: "5.5" });
    expect(await testPrisma.stockMovement.count()).toBe(2);
  });

  it("restarts the average cost from the entry when the previous balance is not positive", async () => {
    const { headers } = await authenticateAs(app, [Permission.ENTRIES_CREATE]);
    const product = await createProduct();
    await testPrisma.productStock.create({
      data: { productSku: product.sku, quantity: "-5", lastEntryCost: "4", averageCost: "4" },
    });

    const response = await postEntry(headers, { productSku: product.sku, quantity: "10", unitCost: "6" });

    expect(response.json().stock).toEqual({ quantity: "5", lastEntryCost: "6", averageCost: "6" });
  });

  it("leaves the minimum quantity of the stock untouched", async () => {
    const { headers } = await authenticateAs(app, [Permission.ENTRIES_CREATE]);
    const product = await createProduct();
    await testPrisma.productStock.create({ data: { productSku: product.sku, minimumQuantity: "20" } });

    await postEntry(headers, { productSku: product.sku, quantity: "1", unitCost: "1" });

    expect((await stockOf(product.sku))?.minimumQuantity?.toString()).toBe("20");
  });

  it("loses no entry when several arrive at once", async () => {
    const { headers } = await authenticateAs(app, [Permission.ENTRIES_CREATE]);
    const product = await createProduct();

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => postEntry(headers, { productSku: product.sku, quantity: "2.5", unitCost: "3" })),
    );

    expect(responses.map((response) => response.statusCode)).toEqual(Array(8).fill(201));
    expect((await stockOf(product.sku))?.quantity.toString()).toBe("20");
    expect((await stockOf(product.sku))?.averageCost?.toString()).toBe("3");
    expect(await testPrisma.stockMovement.count()).toBe(8);
  });

  it("answers 404 for a product that does not exist, and writes nothing", async () => {
    const { headers } = await authenticateAs(app, [Permission.ENTRIES_CREATE]);

    const response = await postEntry(headers, {
      productSku: "0199a1f0-0000-7000-8000-0000000000ff",
      quantity: "1",
      unitCost: "1",
    });

    expect(response.statusCode).toBe(404);
    expect(await testPrisma.stockMovement.count()).toBe(0);
  });

  it("answers 409 for an inactive product, and writes nothing", async () => {
    const { headers } = await authenticateAs(app, [Permission.ENTRIES_CREATE]);
    const product = await createProduct({ isActive: false });

    const response = await postEntry(headers, { productSku: product.sku, quantity: "1", unitCost: "1" });

    expect(response.statusCode).toBe(409);
    expect(await testPrisma.stockMovement.count()).toBe(0);
    expect(await stockOf(product.sku)).toBeNull();
  });

  it.each([
    ["a zero quantity", { quantity: "0", unitCost: "1" }],
    ["a negative quantity", { quantity: "-1", unitCost: "1" }],
    ["a quantity with more than six decimal places", { quantity: "1.0000001", unitCost: "1" }],
    ["a quantity that is not a decimal", { quantity: "ten", unitCost: "1" }],
    ["a negative unit cost", { quantity: "1", unitCost: "-0.01" }],
    ["a missing unit cost", { quantity: "1" }],
  ])("answers 400 for %s", async (_label, amounts) => {
    const { headers } = await authenticateAs(app, [Permission.ENTRIES_CREATE]);
    const product = await createProduct();

    const response = await postEntry(headers, { productSku: product.sku, ...amounts });

    expect(response.statusCode).toBe(400);
    expect(await testPrisma.stockMovement.count()).toBe(0);
  });

  it("accepts a zero unit cost, for goods received free of charge", async () => {
    const { headers } = await authenticateAs(app, [Permission.ENTRIES_CREATE]);
    const product = await createProduct();

    const response = await postEntry(headers, { productSku: product.sku, quantity: "1", unitCost: "0" });

    expect(response.statusCode).toBe(201);
  });

  it("answers 403 without ENTRIES_CREATE", async () => {
    const { headers } = await authenticateAs(app, [Permission.ENTRIES_READ]);
    const product = await createProduct();

    const response = await postEntry(headers, { productSku: product.sku, quantity: "1", unitCost: "1" });

    expect(response.statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await postEntry(undefined, { productSku: "x", quantity: "1", unitCost: "1" })).statusCode).toBe(401);
  });
});
