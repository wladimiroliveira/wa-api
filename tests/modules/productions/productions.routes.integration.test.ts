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
async function createDough() {
  const [dough, flour, water] = await Promise.all([
    createProduct("Bread dough", { kind: "MANUFACTURED" }),
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

// Syrup: 10 L out of 4 kg of sugar.
async function createSyrup() {
  const [syrup, sugar] = await Promise.all([
    createProduct("Syrup", { kind: "MANUFACTURED", unit: "LITER" }),
    createProduct("Sugar"),
  ]);

  await testPrisma.recipe.create({
    data: {
      productSku: syrup.sku,
      yieldQuantity: "10",
      ingredients: { create: [{ productSku: sugar.sku, quantity: "4" }] },
    },
  });

  return { syrup, sugar };
}

// A pre-weighing for 50 kg of dough that weighed a little off the plan.
async function createDoughPreWeighing(userId: string) {
  const products = await createDough();
  const preWeighing = await testPrisma.preWeighing.create({
    data: {
      productSku: products.dough.sku,
      quantity: "50",
      createdById: userId,
      items: {
        create: [
          { productSku: products.flour.sku, plannedQuantity: "30", weighedQuantity: "30.25" },
          { productSku: products.water.sku, plannedQuantity: "18", weighedQuantity: "17.9" },
        ],
      },
    },
  });

  return { ...products, preWeighing };
}

const stock = (productSku: string, quantity: string, averageCost: string) =>
  testPrisma.productStock.create({ data: { productSku, quantity, averageCost, lastEntryCost: averageCost } });

async function stockOf(productSku: string) {
  const found = await testPrisma.productStock.findUnique({ where: { productSku } });

  return found === null
    ? null
    : { quantity: found.quantity.toString(), averageCost: found.averageCost?.toString() ?? null };
}

const postProduction = (headers: Headers, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/productions", headers, payload });

const getProduction = (headers: Headers, id: string) =>
  app.inject({ method: "GET", url: `/v1/productions/${id}`, headers });

const postCancel = (headers: Headers, id: string) =>
  app.inject({ method: "POST", url: `/v1/productions/${id}/cancel`, headers });

const listProductions = (headers: Headers, query: Record<string, string> = {}) =>
  app.inject({ method: "GET", url: "/v1/productions", headers, query });

const postFinish = (headers: Headers, id: string, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: `/v1/productions/${id}/finish`, headers, payload });

const canRead = () => authenticateAs(app, [Permission.PRODUCTION_READ]);
const canCreate = () => authenticateAs(app, [Permission.PRODUCTION_CREATE]);
const canDoBoth = () => authenticateAs(app, [Permission.PRODUCTION_READ, Permission.PRODUCTION_CREATE]);

describe("POST /v1/productions", () => {
  it("starts a free production, planning the inputs by the recipe and the expected yield", async () => {
    const { headers, userId } = await canCreate();
    const { dough, flour, water } = await createDough();

    const response = await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: expect.any(String),
      status: "IN_PROGRESS",
      createdAt: expect.any(String),
      finishedAt: null,
      canceledAt: null,
      items: [
        {
          id: expect.any(String),
          product: { sku: dough.sku, description: "Bread dough", unit: "KILOGRAM" },
          preWeighingId: null,
          expectedQuantity: "50",
          producedQuantity: null,
          unitCost: null,
          inputs: [
            { product: { sku: water.sku, description: "Water", unit: "LITER" }, quantity: "18", unitCost: null },
            {
              product: { sku: flour.sku, description: "Wheat flour", unit: "KILOGRAM" },
              quantity: "30",
              unitCost: null,
            },
          ],
        },
      ],
    });

    const stored = await testPrisma.production.findMany();

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: response.json().id, createdById: userId });
  });

  it("starts a guided production, taking what the pre-weighing weighed", async () => {
    const { headers, userId } = await canCreate();
    const { dough, flour, water, preWeighing } = await createDoughPreWeighing(userId);

    const response = await postProduction(headers, { items: [{ preWeighingId: preWeighing.id }] });

    expect(response.statusCode).toBe(201);
    expect(response.json().items).toEqual([
      expect.objectContaining({
        product: { sku: dough.sku, description: "Bread dough", unit: "KILOGRAM" },
        preWeighingId: preWeighing.id,
        expectedQuantity: "50",
        inputs: [
          { product: expect.objectContaining({ sku: water.sku }), quantity: "17.9", unitCost: null },
          { product: expect.objectContaining({ sku: flour.sku }), quantity: "30.25", unitCost: null },
        ],
      }),
    ]);
  });

  it("takes several recipes in one production, guided and free alike", async () => {
    const { headers, userId } = await canCreate();
    const { dough, preWeighing } = await createDoughPreWeighing(userId);
    const { syrup, sugar } = await createSyrup();

    const response = await postProduction(headers, {
      items: [{ productSku: syrup.sku, quantity: "5" }, { preWeighingId: preWeighing.id }],
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().items).toMatchObject([
      { product: { sku: dough.sku }, preWeighingId: preWeighing.id, expectedQuantity: "50" },
      {
        product: { sku: syrup.sku },
        preWeighingId: null,
        expectedQuantity: "5",
        inputs: [{ product: { sku: sugar.sku }, quantity: "2" }],
      },
    ]);
  });

  it("leaves the stock untouched", async () => {
    const { headers } = await canCreate();
    const { dough, flour } = await createDough();
    await stock(flour.sku, "100", "2");

    await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] });

    expect(await stockOf(flour.sku)).toEqual({ quantity: "100", averageCost: "2" });
    expect(await testPrisma.stockMovement.count()).toBe(0);
  });

  it("keeps the inputs it planned when the recipe changes afterwards", async () => {
    const { headers } = await canCreate();
    const { dough } = await createDough();
    await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] });

    await testPrisma.recipeIngredient.updateMany({ data: { quantity: "1" } });

    const inputs = await testPrisma.productionItemInput.findMany();

    expect(inputs.map((input) => input.quantity.toString()).sort()).toEqual(["18", "30"]);
  });

  it("answers 409 for a pre-weighing that already guides a production, and writes nothing", async () => {
    const { headers, userId } = await canCreate();
    const { preWeighing } = await createDoughPreWeighing(userId);
    await postProduction(headers, { items: [{ preWeighingId: preWeighing.id }] });

    const response = await postProduction(headers, { items: [{ preWeighingId: preWeighing.id }] });

    expect(response.statusCode).toBe(409);
    expect(await testPrisma.production.count()).toBe(1);
  });

  it("answers 404 for a pre-weighing that does not exist", async () => {
    const { headers } = await canCreate();

    expect((await postProduction(headers, { items: [{ preWeighingId: MISSING_ID }] })).statusCode).toBe(404);
  });

  it("answers 404 for a product that does not exist", async () => {
    const { headers } = await canCreate();

    const response = await postProduction(headers, { items: [{ productSku: MISSING_ID, quantity: "1" }] });

    expect(response.statusCode).toBe(404);
  });

  it("answers 409 when one of the products has no recipe, and writes nothing", async () => {
    const { headers } = await canCreate();
    const { dough } = await createDough();
    const filling = await createProduct("Filling", { kind: "MANUFACTURED" });

    const response = await postProduction(headers, {
      items: [
        { productSku: dough.sku, quantity: "50" },
        { productSku: filling.sku, quantity: "1" },
      ],
    });

    expect(response.statusCode).toBe(409);
    expect(await testPrisma.production.count()).toBe(0);
  });

  it.each([
    ["no item", () => []],
    ["a zero quantity", (ids: Ids) => [{ productSku: ids.dough, quantity: "0" }]],
    ["a free item with no quantity", (ids: Ids) => [{ productSku: ids.dough }]],
    [
      "an item that is guided and free at once",
      (ids: Ids) => [{ preWeighingId: ids.preWeighing, productSku: ids.dough, quantity: "1" }],
    ],
    ["an item that is neither guided nor free", () => [{}]],
    [
      "the same pre-weighing twice",
      (ids: Ids) => [{ preWeighingId: ids.preWeighing }, { preWeighingId: ids.preWeighing }],
    ],
  ])("answers 400 for %s", async (_label, itemsFor: (ids: Ids) => unknown[]) => {
    const { headers, userId } = await canCreate();
    const { dough, preWeighing } = await createDoughPreWeighing(userId);

    const response = await postProduction(headers, {
      items: itemsFor({ dough: dough.sku, preWeighing: preWeighing.id }),
    });

    expect(response.statusCode).toBe(400);
    expect(await testPrisma.production.count()).toBe(0);
  });

  it("answers 403 without PRODUCTION_CREATE", async () => {
    const { headers } = await canRead();

    expect((await postProduction(headers, {})).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await postProduction(undefined, {})).statusCode).toBe(401);
  });
});

describe("GET /v1/productions/:id", () => {
  it("returns the production as it stands", async () => {
    const { headers } = await canDoBoth();
    const { dough } = await createDough();
    const started = await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] });

    const response = await getProduction(headers, started.json().id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(started.json());
  });

  it("answers 404 for a production that does not exist", async () => {
    const { headers } = await canRead();

    expect((await getProduction(headers, MISSING_ID)).statusCode).toBe(404);
  });

  it("answers 403 without PRODUCTION_READ", async () => {
    const { headers } = await canCreate();

    expect((await getProduction(headers, MISSING_ID)).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await getProduction(undefined, MISSING_ID)).statusCode).toBe(401);
  });
});

describe("POST /v1/productions/:id/finish", () => {
  // 50 kg of dough takes 30 kg of flour at 2.00 and 18 L of water at 0.50: 69.00 of inputs.
  async function startDough(headers: Headers) {
    const products = await createDough();
    await stock(products.flour.sku, "100", "2");
    await stock(products.water.sku, "50", "0.5");
    const started = await postProduction(headers, { items: [{ productSku: products.dough.sku, quantity: "50" }] });

    return { ...products, production: started.json() };
  }

  it("writes the inputs off the stock and brings the product in at what they cost", async () => {
    const { headers, userId } = await canDoBoth();
    const { dough, flour, water, production } = await startDough(headers);

    const response = await postFinish(headers, production.id, {
      items: [{ id: production.items[0].id, producedQuantity: "46" }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: production.id,
      status: "FINISHED",
      finishedAt: expect.any(String),
      items: [
        {
          expectedQuantity: "50",
          producedQuantity: "46",
          unitCost: "1.5",
          inputs: [
            { product: { sku: water.sku }, quantity: "18", unitCost: "0.5" },
            { product: { sku: flour.sku }, quantity: "30", unitCost: "2" },
          ],
        },
      ],
    });
    expect(await getProduction(headers, production.id).then((found) => found.json())).toEqual(response.json());

    expect(await stockOf(flour.sku)).toEqual({ quantity: "70", averageCost: "2" });
    expect(await stockOf(water.sku)).toEqual({ quantity: "32", averageCost: "0.5" });
    expect(await stockOf(dough.sku)).toEqual({ quantity: "46", averageCost: "1.5" });

    const movements = await testPrisma.stockMovement.findMany();
    const summary = movements
      .map((movement) => {
        expect(movement.createdById).toBe(userId);
        return `${movement.type} ${movement.productSku} ${movement.quantity} @ ${movement.unitCost}`;
      })
      .sort();

    expect(summary).toEqual(
      [
        `PRODUCTION_CONSUMPTION ${flour.sku} 30 @ 2`,
        `PRODUCTION_CONSUMPTION ${water.sku} 18 @ 0.5`,
        `PRODUCTION_OUTPUT ${dough.sku} 46 @ 1.5`,
      ].sort(),
    );
  });

  it("writes off what was weighed when a pre-weighing guided the item", async () => {
    const { headers, userId } = await canDoBoth();
    const { flour, water, preWeighing } = await createDoughPreWeighing(userId);
    await stock(flour.sku, "100", "2");
    await stock(water.sku, "50", "0.5");
    const production = (await postProduction(headers, { items: [{ preWeighingId: preWeighing.id }] })).json();

    const response = await postFinish(headers, production.id, {
      items: [{ id: production.items[0].id, producedQuantity: "50" }],
    });

    expect(response.statusCode).toBe(200);
    expect(await stockOf(flour.sku)).toEqual({ quantity: "69.75", averageCost: "2" });
    expect(await stockOf(water.sku)).toEqual({ quantity: "32.1", averageCost: "0.5" });
  });

  it("finishes every item of a production with several recipes", async () => {
    const { headers } = await canDoBoth();
    const { dough } = await createDough();
    const { syrup, sugar } = await createSyrup();
    const production = (
      await postProduction(headers, {
        items: [
          { productSku: dough.sku, quantity: "50" },
          { productSku: syrup.sku, quantity: "5" },
        ],
      })
    ).json();
    const [doughItem, syrupItem] = production.items;

    const response = await postFinish(headers, production.id, {
      items: [
        { id: syrupItem.id, producedQuantity: "4.5" },
        { id: doughItem.id, producedQuantity: "48" },
      ],
    });

    expect(response.statusCode).toBe(200);
    expect(await stockOf(dough.sku)).toMatchObject({ quantity: "48" });
    expect(await stockOf(syrup.sku)).toMatchObject({ quantity: "4.5" });
    expect(await stockOf(sugar.sku)).toMatchObject({ quantity: "-2" });
  });

  it("lets the balance of an input go negative, and counts no cost for one that never entered", async () => {
    const { headers } = await canDoBoth();
    const { dough, flour, water } = await createDough();
    await stock(flour.sku, "10", "2");
    const production = (await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] })).json();

    const response = await postFinish(headers, production.id, {
      items: [{ id: production.items[0].id, producedQuantity: "50" }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].unitCost).toBe("1.2");
    expect(await stockOf(flour.sku)).toEqual({ quantity: "-20", averageCost: "2" });
    expect(await stockOf(water.sku)).toEqual({ quantity: "-18", averageCost: null });
  });

  it("weights what it produced into the average cost of the product already in stock", async () => {
    const { headers } = await canDoBoth();
    const { dough, production } = await startDough(headers);
    await stock(dough.sku, "46", "3");

    await postFinish(headers, production.id, { items: [{ id: production.items[0].id, producedQuantity: "46" }] });

    expect(await stockOf(dough.sku)).toEqual({ quantity: "92", averageCost: "2.25" });
  });

  it("answers 409 for a production that is already finished, and moves the stock only once", async () => {
    const { headers } = await canDoBoth();
    const { flour, production } = await startDough(headers);
    const payload = { items: [{ id: production.items[0].id, producedQuantity: "46" }] };
    await postFinish(headers, production.id, payload);

    const response = await postFinish(headers, production.id, payload);

    expect(response.statusCode).toBe(409);
    expect(await stockOf(flour.sku)).toMatchObject({ quantity: "70" });
    expect(await testPrisma.stockMovement.count()).toBe(3);
  });

  it.each([
    ["leave an item of the production out", (ids: string[]) => [{ id: ids[0], producedQuantity: "46" }]],
    [
      "bring an item of another production",
      (ids: string[]) => [
        { id: ids[0], producedQuantity: "46" },
        { id: MISSING_ID, producedQuantity: "4" },
      ],
    ],
  ])("answers 409 when the items %s, and moves nothing", async (_label, itemsFor) => {
    const { headers } = await canDoBoth();
    const { dough } = await createDough();
    const { syrup } = await createSyrup();
    const production = (
      await postProduction(headers, {
        items: [
          { productSku: dough.sku, quantity: "50" },
          { productSku: syrup.sku, quantity: "5" },
        ],
      })
    ).json();

    const response = await postFinish(headers, production.id, {
      items: itemsFor(production.items.map((item: { id: string }) => item.id)),
    });

    expect(response.statusCode).toBe(409);
    expect(await testPrisma.stockMovement.count()).toBe(0);
    expect((await testPrisma.production.findUniqueOrThrow({ where: { id: production.id } })).status).toBe(
      "IN_PROGRESS",
    );
  });

  it("answers 409 when the cost of a produced unit does not fit, and undoes what it had moved", async () => {
    const { headers } = await canDoBoth();
    const { dough, flour } = await createDough();
    await stock(flour.sku, "100", "900000000000");
    const production = (await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] })).json();

    const response = await postFinish(headers, production.id, {
      items: [{ id: production.items[0].id, producedQuantity: "0.000001" }],
    });

    expect(response.statusCode).toBe(409);
    expect(await stockOf(flour.sku)).toMatchObject({ quantity: "100" });
    expect(await testPrisma.stockMovement.count()).toBe(0);
    expect((await getProduction(headers, production.id)).json()).toMatchObject({ status: "IN_PROGRESS" });
  });

  it("answers 404 for a production that does not exist", async () => {
    const { headers } = await canCreate();

    const response = await postFinish(headers, MISSING_ID, { items: [{ id: MISSING_ID, producedQuantity: "1" }] });

    expect(response.statusCode).toBe(404);
  });

  it.each([
    ["no item", () => []],
    ["a zero produced quantity", (id: string) => [{ id, producedQuantity: "0" }]],
    ["a missing produced quantity", (id: string) => [{ id }]],
    [
      "the same item twice",
      (id: string) => [
        { id, producedQuantity: "1" },
        { id, producedQuantity: "2" },
      ],
    ],
  ])("answers 400 for %s", async (_label, itemsFor: (id: string) => unknown[]) => {
    const { headers } = await canDoBoth();
    const { production } = await startDough(headers);

    const response = await postFinish(headers, production.id, { items: itemsFor(production.items[0].id) });

    expect(response.statusCode).toBe(400);
    expect(await testPrisma.stockMovement.count()).toBe(0);
  });

  it("answers 403 without PRODUCTION_CREATE", async () => {
    const { headers } = await canRead();

    expect((await postFinish(headers, MISSING_ID, {})).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await postFinish(undefined, MISSING_ID, {})).statusCode).toBe(401);
  });
});

describe("POST /v1/productions/:id/cancel", () => {
  it("cancels a production in progress and leaves the stock untouched", async () => {
    const { headers } = await canDoBoth();
    const { dough, flour } = await createDough();
    await stock(flour.sku, "100", "2");
    const production = (await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] })).json();

    const response = await postCancel(headers, production.id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ...production, status: "CANCELED", canceledAt: expect.any(String) });
    expect((await getProduction(headers, production.id)).json()).toEqual(response.json());
    expect(await stockOf(flour.sku)).toEqual({ quantity: "100", averageCost: "2" });
    expect(await testPrisma.stockMovement.count()).toBe(0);
  });

  it("frees the pre-weighing that guided it for another production", async () => {
    const { headers, userId } = await canDoBoth();
    const { preWeighing } = await createDoughPreWeighing(userId);
    const production = (await postProduction(headers, { items: [{ preWeighingId: preWeighing.id }] })).json();

    const canceled = await postCancel(headers, production.id);
    const again = await postProduction(headers, { items: [{ preWeighingId: preWeighing.id }] });

    expect(canceled.json().items[0].preWeighingId).toBeNull();
    expect(again.statusCode).toBe(201);
    expect(again.json().items[0].preWeighingId).toBe(preWeighing.id);
  });

  it("answers 409 for a production that is already canceled", async () => {
    const { headers } = await canDoBoth();
    const { dough } = await createDough();
    const production = (await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] })).json();
    await postCancel(headers, production.id);

    expect((await postCancel(headers, production.id)).statusCode).toBe(409);
  });

  it("answers 409 for a finished production, and keeps it finished and guided", async () => {
    const { headers, userId } = await canDoBoth();
    const { preWeighing } = await createDoughPreWeighing(userId);
    const production = (await postProduction(headers, { items: [{ preWeighingId: preWeighing.id }] })).json();
    await postFinish(headers, production.id, { items: [{ id: production.items[0].id, producedQuantity: "50" }] });

    const response = await postCancel(headers, production.id);

    expect(response.statusCode).toBe(409);
    expect((await getProduction(headers, production.id)).json()).toMatchObject({
      status: "FINISHED",
      canceledAt: null,
      items: [{ preWeighingId: preWeighing.id }],
    });
  });

  it("keeps a canceled production from finishing, and moves nothing", async () => {
    const { headers } = await canDoBoth();
    const { dough } = await createDough();
    const production = (await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] })).json();
    await postCancel(headers, production.id);

    const response = await postFinish(headers, production.id, {
      items: [{ id: production.items[0].id, producedQuantity: "50" }],
    });

    expect(response.statusCode).toBe(409);
    expect(await testPrisma.stockMovement.count()).toBe(0);
  });

  it("answers 404 for a production that does not exist", async () => {
    const { headers } = await canCreate();

    expect((await postCancel(headers, MISSING_ID)).statusCode).toBe(404);
  });

  it("answers 403 without PRODUCTION_CREATE", async () => {
    const { headers } = await canRead();

    expect((await postCancel(headers, MISSING_ID)).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await postCancel(undefined, MISSING_ID)).statusCode).toBe(401);
  });
});

describe("GET /v1/productions", () => {
  // Three productions, started a day apart, named from the oldest to the newest.
  async function startThree(headers: Headers) {
    const { dough } = await createDough();
    const ids: string[] = [];

    for (const day of ["01", "02", "03"]) {
      const { id } = (await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] })).json();
      await testPrisma.production.update({ where: { id }, data: { createdAt: new Date(`2026-10-${day}T12:00:00Z`) } });
      ids.push(id);
    }

    return ids;
  }

  const idsOf = (response: { json: () => { items: { id: string }[] } }) => response.json().items.map(({ id }) => id);

  it("lists the productions, the newest first, each as it stands", async () => {
    const { headers } = await canDoBoth();
    const [first, second, third] = await startThree(headers);

    const response = await listProductions(headers);

    expect(response.statusCode).toBe(200);
    expect(idsOf(response)).toEqual([third, second, first]);
    expect(response.json().nextCursor).toBeNull();
    expect(response.json().items[0]).toEqual((await getProduction(headers, third)).json());
  });

  it("lists only the productions in the status asked for", async () => {
    const { headers } = await canDoBoth();
    const [first, second, third] = await startThree(headers);
    await postCancel(headers, second);

    expect(idsOf(await listProductions(headers, { status: "IN_PROGRESS" }))).toEqual([third, first]);
    expect(idsOf(await listProductions(headers, { status: "CANCELED" }))).toEqual([second]);
    expect(idsOf(await listProductions(headers, { status: "FINISHED" }))).toEqual([]);
  });

  it("hands the list out in pages, each pointing to the next", async () => {
    const { headers } = await canDoBoth();
    const [first, second, third] = await startThree(headers);

    const page = await listProductions(headers, { limit: "2" });

    expect(idsOf(page)).toEqual([third, second]);
    expect(page.json().nextCursor).toBe(second);

    const next = await listProductions(headers, { limit: "2", cursor: page.json().nextCursor });

    expect(idsOf(next)).toEqual([first]);
    expect(next.json().nextCursor).toBeNull();
  });

  it.each([
    ["a zero limit", { limit: "0" }],
    ["a limit above a hundred", { limit: "101" }],
    ["a limit that is not a number", { limit: "many" }],
    ["a cursor that is not an id", { cursor: "next" }],
    ["a status that does not exist", { status: "PAUSED" }],
  ])("answers 400 for %s", async (_label, query: Record<string, string>) => {
    const { headers } = await canRead();

    expect((await listProductions(headers, query)).statusCode).toBe(400);
  });

  it("answers 403 without PRODUCTION_READ", async () => {
    const { headers } = await canCreate();

    expect((await listProductions(headers)).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await listProductions(undefined)).statusCode).toBe(401);
  });
});

type Ids = { dough: string; preWeighing: string };
