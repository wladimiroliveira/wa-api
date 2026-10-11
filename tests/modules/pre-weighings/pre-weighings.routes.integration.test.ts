import { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { MeasurementUnit, Permission, ProductKind } from "../../../src/generated/prisma/index.js";
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

const MISSING_ID = "0199a1f0-0000-7000-8000-0000000000ff";

type ProductOverrides = { kind?: ProductKind; unit?: MeasurementUnit; isActive?: boolean };
type Headers = { authorization: string } | undefined;

const createProduct = (description: string, overrides: ProductOverrides = {}) =>
  testPrisma.product.create({ data: { description, kind: "GOODS", unit: "KILOGRAM", ...overrides } });

// Bread dough: 25 kg out of 15 kg of flour and 9 L of water.
async function createDough(overrides: ProductOverrides = {}) {
  const [dough, flour, water] = await Promise.all([
    createProduct("Bread dough", { kind: "MANUFACTURED", ...overrides }),
    createProduct("Wheat flour"),
    createProduct("Water", { unit: "LITER" }),
  ]);

  await testPrisma.recipe.create({
    data: {
      productSku: dough.sku,
      yieldQuantity: "25",
      ingredients: {
        create: [
          { productSku: flour.sku, quantity: "15" },
          { productSku: water.sku, quantity: "9" },
        ],
      },
    },
  });

  return { dough, flour, water };
}

const getPlan = (headers: Headers, query: Record<string, string>) =>
  app.inject({ method: "GET", url: "/v1/pre-weighings/plan", headers, query });

const postPreWeighing = (headers: Headers, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/pre-weighings", headers, payload });

const getPreWeighing = (headers: Headers, id: string) =>
  app.inject({ method: "GET", url: `/v1/pre-weighings/${id}`, headers });

const canRead = () => authenticateAs(app, [Permission.PRODUCTION_READ]);
const canCreate = () => authenticateAs(app, [Permission.PRODUCTION_CREATE]);

describe("GET /v1/pre-weighings/plan", () => {
  it("scales the recipe to the quantity to produce", async () => {
    const { headers } = await canRead();
    const { dough, flour, water } = await createDough();

    const response = await getPlan(headers, { productSku: dough.sku, quantity: "50" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      product: { sku: dough.sku, description: "Bread dough", unit: "KILOGRAM" },
      quantity: "50",
      items: [
        { product: { sku: water.sku, description: "Water", unit: "LITER" }, plannedQuantity: "18" },
        { product: { sku: flour.sku, description: "Wheat flour", unit: "KILOGRAM" }, plannedQuantity: "30" },
      ],
    });
  });

  it("writes nothing", async () => {
    const { headers } = await canRead();
    const { dough } = await createDough();

    await getPlan(headers, { productSku: dough.sku, quantity: "50" });

    expect(await testPrisma.preWeighing.count()).toBe(0);
  });

  it("answers 404 for a product that does not exist", async () => {
    const { headers } = await canRead();

    expect((await getPlan(headers, { productSku: MISSING_ID, quantity: "1" })).statusCode).toBe(404);
  });

  it("answers 409 for a product that has no recipe", async () => {
    const { headers } = await canRead();
    const product = await createProduct("Filling", { kind: "MANUFACTURED" });

    expect((await getPlan(headers, { productSku: product.sku, quantity: "1" })).statusCode).toBe(409);
  });

  it("answers 409 for an inactive product", async () => {
    const { headers } = await canRead();
    const { dough } = await createDough({ isActive: false });

    expect((await getPlan(headers, { productSku: dough.sku, quantity: "1" })).statusCode).toBe(409);
  });

  it("answers 409 when the recipe takes an inactive ingredient", async () => {
    const { headers } = await canRead();
    const { dough, flour } = await createDough();
    await testPrisma.product.update({ where: { sku: flour.sku }, data: { isActive: false } });

    expect((await getPlan(headers, { productSku: dough.sku, quantity: "1" })).statusCode).toBe(409);
  });

  it("answers 409 for a quantity too small to give every ingredient a weight", async () => {
    const { headers } = await canRead();
    const { dough } = await createDough();

    expect((await getPlan(headers, { productSku: dough.sku, quantity: "0.000001" })).statusCode).toBe(409);
  });

  it.each([
    ["a zero quantity", { quantity: "0" }],
    ["a quantity that is not a decimal", { quantity: "plenty" }],
    ["a missing quantity", {}],
  ])("answers 400 for %s", async (_label, query: Record<string, string>) => {
    const { headers } = await canRead();
    const { dough } = await createDough();

    expect((await getPlan(headers, { productSku: dough.sku, ...query })).statusCode).toBe(400);
  });

  it("answers 403 without PRODUCTION_READ", async () => {
    const { headers } = await canCreate();

    expect((await getPlan(headers, { productSku: MISSING_ID, quantity: "1" })).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await getPlan(undefined, { productSku: MISSING_ID, quantity: "1" })).statusCode).toBe(401);
  });
});

describe("POST /v1/pre-weighings", () => {
  it("records what was weighed next to what the recipe planned", async () => {
    const { headers, userId } = await canCreate();
    const { dough, flour, water } = await createDough();

    const response = await postPreWeighing(headers, {
      productSku: dough.sku,
      quantity: "50",
      items: [
        { productSku: flour.sku, weighedQuantity: "30.25" },
        { productSku: water.sku, weighedQuantity: "17.9" },
      ],
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      product: { sku: dough.sku, description: "Bread dough", unit: "KILOGRAM" },
      quantity: "50",
      items: [
        { product: { sku: water.sku, unit: "LITER" }, plannedQuantity: "18", weighedQuantity: "17.9" },
        { product: { sku: flour.sku, unit: "KILOGRAM" }, plannedQuantity: "30", weighedQuantity: "30.25" },
      ],
    });

    const stored = await testPrisma.preWeighing.findMany({ include: { items: true } });

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: response.json().id, productSku: dough.sku, createdById: userId });
    expect(stored[0].items).toHaveLength(2);
  });

  it("keeps the planned quantities it recorded when the recipe changes afterwards", async () => {
    const { headers } = await canCreate();
    const { dough, flour, water } = await createDough();
    const response = await postPreWeighing(headers, {
      productSku: dough.sku,
      quantity: "50",
      items: [
        { productSku: flour.sku, weighedQuantity: "30" },
        { productSku: water.sku, weighedQuantity: "18" },
      ],
    });

    await testPrisma.recipeIngredient.updateMany({ data: { quantity: "1" } });

    const items = await testPrisma.preWeighingItem.findMany({ where: { preWeighingId: response.json().id } });

    expect(items.map((item) => item.plannedQuantity.toString()).sort()).toEqual(["18", "30"]);
  });

  it("leaves the stock untouched", async () => {
    const { headers } = await canCreate();
    const { dough, flour, water } = await createDough();
    await testPrisma.productStock.create({ data: { productSku: flour.sku, quantity: "100" } });

    await postPreWeighing(headers, {
      productSku: dough.sku,
      quantity: "50",
      items: [
        { productSku: flour.sku, weighedQuantity: "30" },
        { productSku: water.sku, weighedQuantity: "18" },
      ],
    });

    const stock = await testPrisma.productStock.findUnique({ where: { productSku: flour.sku } });

    expect(stock?.quantity.toString()).toBe("100");
    expect(await testPrisma.stockMovement.count()).toBe(0);
  });

  it.each([
    ["leave an ingredient of the recipe out", (skus: Skus) => [{ productSku: skus.flour, weighedQuantity: "30" }]],
    [
      "bring a product the recipe does not take",
      (skus: Skus) => [
        { productSku: skus.flour, weighedQuantity: "30" },
        { productSku: skus.water, weighedQuantity: "18" },
        { productSku: skus.salt, weighedQuantity: "1" },
      ],
    ],
  ])("answers 409 when the items %s, and writes nothing", async (_label, itemsFor) => {
    const { headers } = await canCreate();
    const { dough, flour, water } = await createDough();
    const salt = await createProduct("Salt");

    const response = await postPreWeighing(headers, {
      productSku: dough.sku,
      quantity: "50",
      items: itemsFor({ flour: flour.sku, water: water.sku, salt: salt.sku }),
    });

    expect(response.statusCode).toBe(409);
    expect(await testPrisma.preWeighing.count()).toBe(0);
  });

  it("answers 404 for a product that does not exist", async () => {
    const { headers } = await canCreate();

    const response = await postPreWeighing(headers, {
      productSku: MISSING_ID,
      quantity: "1",
      items: [{ productSku: MISSING_ID, weighedQuantity: "1" }],
    });

    expect(response.statusCode).toBe(404);
  });

  it("answers 409 for a product that has no recipe, and writes nothing", async () => {
    const { headers } = await canCreate();
    const product = await createProduct("Filling", { kind: "MANUFACTURED" });
    const flour = await createProduct("Wheat flour");

    const response = await postPreWeighing(headers, {
      productSku: product.sku,
      quantity: "1",
      items: [{ productSku: flour.sku, weighedQuantity: "1" }],
    });

    expect(response.statusCode).toBe(409);
    expect(await testPrisma.preWeighing.count()).toBe(0);
  });

  it.each([
    ["a zero quantity", { quantity: "0" }],
    ["a missing quantity", { quantity: undefined }],
    ["no item", { items: [] }],
    ["a zero weighed quantity", { weighedQuantity: "0" }],
    ["a weighed quantity with more than six decimal places", { weighedQuantity: "1.0000001" }],
    ["a missing weighed quantity", { weighedQuantity: undefined }],
    ["the same item twice", { repeat: true }],
  ])("answers 400 for %s", async (_label, change: Record<string, unknown>) => {
    const { headers } = await canCreate();
    const { dough, flour, water } = await createDough();
    const weighedQuantity = "weighedQuantity" in change ? change.weighedQuantity : "30";
    const items = [
      { productSku: flour.sku, weighedQuantity },
      { productSku: change.repeat ? flour.sku : water.sku, weighedQuantity: "18" },
    ];

    const response = await postPreWeighing(headers, {
      productSku: dough.sku,
      quantity: "quantity" in change ? change.quantity : "50",
      items: change.items ?? items,
    });

    expect(response.statusCode).toBe(400);
    expect(await testPrisma.preWeighing.count()).toBe(0);
  });

  it("answers 403 without PRODUCTION_CREATE", async () => {
    const { headers } = await canRead();

    expect((await postPreWeighing(headers, {})).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await postPreWeighing(undefined, {})).statusCode).toBe(401);
  });
});

describe("GET /v1/pre-weighings/:id", () => {
  it("returns the pre-weighing as it was recorded", async () => {
    const { headers } = await authenticateAs(app, [Permission.PRODUCTION_READ, Permission.PRODUCTION_CREATE]);
    const { dough, flour, water } = await createDough();
    const recorded = await postPreWeighing(headers, {
      productSku: dough.sku,
      quantity: "50",
      items: [
        { productSku: flour.sku, weighedQuantity: "30.25" },
        { productSku: water.sku, weighedQuantity: "17.9" },
      ],
    });

    const response = await getPreWeighing(headers, recorded.json().id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(recorded.json());
  });

  it("answers 404 for a pre-weighing that does not exist", async () => {
    const { headers } = await canRead();

    expect((await getPreWeighing(headers, MISSING_ID)).statusCode).toBe(404);
  });

  it("answers 403 without PRODUCTION_READ", async () => {
    const { headers } = await canCreate();

    expect((await getPreWeighing(headers, MISSING_ID)).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await getPreWeighing(undefined, MISSING_ID)).statusCode).toBe(401);
  });
});

type Skus = { flour: string; water: string; salt: string };
