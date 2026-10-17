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

const listProducts = (headers: { authorization: string } | undefined) =>
  app.inject({ method: "GET", url: "/v1/products", headers });

describe("GET /v1/products", () => {
  it("lists every product by description, with what a screen needs to pick one", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_READ]);
    const flour = await testPrisma.product.create({
      data: { description: "Wheat flour", kind: "GOODS", unit: "KILOGRAM", gtin: "7891000100103" },
    });
    await testPrisma.productStock.create({ data: { productSku: flour.sku, quantity: 0, minimumQuantity: "12.5" } });
    const bread = await testPrisma.product.create({
      data: { description: "Bread", kind: "MANUFACTURED", unit: "UNIT", isActive: false },
    });

    const response = await listProducts(headers);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        sku: bread.sku,
        gtin: null,
        description: "Bread",
        kind: "MANUFACTURED",
        unit: "UNIT",
        isActive: false,
        minimumQuantity: null,
      },
      {
        sku: flour.sku,
        gtin: "7891000100103",
        description: "Wheat flour",
        kind: "GOODS",
        unit: "KILOGRAM",
        isActive: true,
        minimumQuantity: "12.5",
      },
    ]);
  });

  it("answers an empty list when the catalog is empty", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_READ]);

    expect((await listProducts(headers)).json()).toEqual([]);
  });

  it("answers 403 without CATALOG_READ", async () => {
    const { headers } = await authenticateAs(app, [Permission.ENTRIES_CREATE]);

    expect((await listProducts(headers)).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await listProducts(undefined)).statusCode).toBe(401);
  });
});

describe("GET /v1/products with filters", () => {
  let headers: { authorization: string };

  const searchProducts = (query: string) => app.inject({ method: "GET", url: `/v1/products?${query}`, headers });

  const descriptionsOf = async (query: string) =>
    (await searchProducts(query)).json().map(({ description }: { description: string }) => description);

  beforeEach(async () => {
    ({ headers } = await authenticateAs(app, [Permission.CATALOG_READ]));
    await testPrisma.product.createMany({
      data: [
        { description: "Pão francês", kind: "MANUFACTURED", unit: "UNIT" },
        { description: "Farinha de trigo", kind: "GOODS", unit: "KILOGRAM", gtin: "7891000100103" },
        { description: "Fermento biológico", kind: "GOODS", unit: "GRAM", gtin: "7896000200204" },
        { description: "Leite integral", kind: "GOODS", unit: "LITER", isActive: false },
      ],
    });
  });

  it("finds by part of the description, whatever the case and the accents", async () => {
    expect(await descriptionsOf("q=PAO")).toEqual(["Pão francês"]);
    expect(await descriptionsOf("q=frances")).toEqual(["Pão francês"]);
    expect(await descriptionsOf("q=biol%C3%B3g")).toEqual(["Fermento biológico"]);
  });

  it("finds by part of the GTIN", async () => {
    expect(await descriptionsOf("q=0001001")).toEqual(["Farinha de trigo"]);
  });

  it("reads the search as plain text, not as a pattern", async () => {
    expect(await descriptionsOf("q=%25")).toEqual([]);
    expect(await descriptionsOf("q=_")).toEqual([]);
  });

  it("ignores a blank search", async () => {
    expect(await descriptionsOf("q=%20%20")).toHaveLength(4);
  });

  it("filters by kind", async () => {
    expect(await descriptionsOf("kind=MANUFACTURED")).toEqual(["Pão francês"]);
  });

  it("filters by any of several units", async () => {
    expect(await descriptionsOf("unit=KILOGRAM&unit=GRAM")).toEqual(["Farinha de trigo", "Fermento biológico"]);
  });

  it("filters the active or the inactive products", async () => {
    expect(await descriptionsOf("status=INACTIVE")).toEqual(["Leite integral"]);
    expect(await descriptionsOf("status=ACTIVE")).toEqual(["Farinha de trigo", "Fermento biológico", "Pão francês"]);
  });

  it("answers only what every filter accepts", async () => {
    expect(await descriptionsOf("q=fer&kind=GOODS&unit=GRAM&status=ACTIVE")).toEqual(["Fermento biológico"]);
    expect(await descriptionsOf("q=leite&status=ACTIVE")).toEqual([]);
  });

  it("answers 400 for a kind, unit or status it does not know", async () => {
    expect((await searchProducts("kind=SERVICE")).statusCode).toBe(400);
    expect((await searchProducts("unit=TON")).statusCode).toBe(400);
    expect((await searchProducts("status=DELETED")).statusCode).toBe(400);
  });
});

const postProduct = (headers: { authorization: string } | undefined, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/products", headers, payload });

const FLOUR = { description: "Wheat flour", kind: "GOODS", unit: "KILOGRAM" };

describe("POST /v1/products", () => {
  it("registers an active product and answers it with its sku", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_CREATE]);

    const response = await postProduct(headers, { ...FLOUR, gtin: "7891000100103" });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      ...FLOUR,
      sku: expect.any(String),
      gtin: "7891000100103",
      isActive: true,
      minimumQuantity: null,
    });
    expect(await testPrisma.product.findUnique({ where: { sku: response.json().sku } })).toMatchObject(FLOUR);
  });

  it("registers the minimum quantity the stock should keep", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_CREATE]);

    const response = await postProduct(headers, { ...FLOUR, minimumQuantity: "25.5" });

    expect(response.statusCode).toBe(201);
    expect(response.json().minimumQuantity).toBe("25.5");
    const stock = await testPrisma.productStock.findUnique({ where: { productSku: response.json().sku } });
    expect(stock?.minimumQuantity?.toString()).toBe("25.5");
    expect(stock?.quantity.toString()).toBe("0");
  });

  it("registers a product that has no GTIN", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_CREATE]);

    const response = await postProduct(headers, FLOUR);

    expect(response.statusCode).toBe(201);
    expect(response.json().gtin).toBeNull();
  });

  it("trims the description before storing it", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_CREATE]);

    const response = await postProduct(headers, { ...FLOUR, description: "  Wheat flour  " });

    expect(response.json().description).toBe("Wheat flour");
  });

  it("answers 409 for a description already in the catalog, and writes nothing", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_CREATE]);
    await postProduct(headers, FLOUR);

    const response = await postProduct(headers, { ...FLOUR, unit: "GRAM" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "A product with this description already exists." });
    expect(await testPrisma.product.count()).toBe(1);
  });

  it("answers 409 for a GTIN already in the catalog, and writes nothing", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_CREATE]);
    await postProduct(headers, { ...FLOUR, gtin: "7891000100103" });

    const response = await postProduct(headers, { ...FLOUR, description: "Rye flour", gtin: "7891000100103" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "A product with this GTIN already exists." });
    expect(await testPrisma.product.count()).toBe(1);
  });

  it.each([
    ["a blank description", { description: "   " }],
    ["a description longer than 120 characters", { description: "x".repeat(121) }],
    ["an unknown kind", { kind: "SERVICE" }],
    ["an unknown unit", { unit: "POUND" }],
    ["a missing unit", { unit: undefined }],
    ["a GTIN that is not made of digits", { gtin: "78910001001AB" }],
    ["a GTIN shorter than 8 digits", { gtin: "1234567" }],
    ["a GTIN longer than 14 digits", { gtin: "123456789012345" }],
    ["a minimum quantity of zero", { minimumQuantity: "0" }],
    ["a minimum quantity that is not a decimal string", { minimumQuantity: 10 }],
  ])("answers 400 for %s", async (_label, overrides) => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_CREATE]);

    const response = await postProduct(headers, { ...FLOUR, ...overrides });

    expect(response.statusCode).toBe(400);
    expect(await testPrisma.product.count()).toBe(0);
  });

  it("answers 403 without CATALOG_CREATE", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_READ]);

    expect((await postProduct(headers, FLOUR)).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await postProduct(undefined, FLOUR)).statusCode).toBe(401);
  });
});

const patchProduct = (headers: { authorization: string } | undefined, sku: string, payload: Record<string, unknown>) =>
  app.inject({ method: "PATCH", url: `/v1/products/${sku}`, headers, payload });

const createFlour = (data: { gtin?: string; isActive?: boolean } = {}) =>
  testPrisma.product.create({ data: { description: "Wheat flour", kind: "GOODS", unit: "KILOGRAM", ...data } });

const UNKNOWN_SKU = "018f0000-0000-7000-8000-0000000000ff";

describe("PATCH /v1/products/:sku", () => {
  it("renames a product and changes its GTIN, keeping its kind and unit", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_UPDATE]);
    const flour = await createFlour({ gtin: "7891000100103" });

    const response = await patchProduct(headers, flour.sku, { description: "  Whole wheat flour ", gtin: "78910003" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      sku: flour.sku,
      description: "Whole wheat flour",
      gtin: "78910003",
      kind: "GOODS",
      unit: "KILOGRAM",
      isActive: true,
      minimumQuantity: null,
    });
  });

  it("removes the GTIN when it is sent as null", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_UPDATE]);
    const flour = await createFlour({ gtin: "7891000100103" });

    const response = await patchProduct(headers, flour.sku, { gtin: null });

    expect(response.json().gtin).toBeNull();
  });

  it("deactivates a product and activates it again", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_UPDATE]);
    const flour = await createFlour();

    expect((await patchProduct(headers, flour.sku, { isActive: false })).json().isActive).toBe(false);
    expect((await patchProduct(headers, flour.sku, { isActive: true })).json().isActive).toBe(true);
  });

  it("sets the minimum quantity of a product that never moved, leaving its balance at zero", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_UPDATE]);
    const flour = await createFlour();

    const response = await patchProduct(headers, flour.sku, { minimumQuantity: "8" });

    expect(response.json().minimumQuantity).toBe("8");
    const stock = await testPrisma.productStock.findUnique({ where: { productSku: flour.sku } });
    expect(stock?.quantity.toString()).toBe("0");
  });

  it("changes and clears the minimum quantity without touching the balance or its costs", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_UPDATE]);
    const flour = await createFlour();
    await testPrisma.productStock.create({
      data: { productSku: flour.sku, quantity: "40", lastEntryCost: "3.5", averageCost: "3.2", minimumQuantity: "5" },
    });

    expect((await patchProduct(headers, flour.sku, { minimumQuantity: "10.25" })).json().minimumQuantity).toBe("10.25");
    expect((await patchProduct(headers, flour.sku, { minimumQuantity: null })).json().minimumQuantity).toBeNull();

    const stock = await testPrisma.productStock.findUnique({ where: { productSku: flour.sku } });
    expect(stock).toMatchObject({ minimumQuantity: null });
    expect([stock?.quantity, stock?.lastEntryCost, stock?.averageCost].map(String)).toEqual(["40", "3.5", "3.2"]);
  });

  it("does not change the kind or the unit", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_UPDATE]);
    const flour = await createFlour();

    await patchProduct(headers, flour.sku, { description: "Rye flour", kind: "MANUFACTURED", unit: "GRAM" });

    expect(await testPrisma.product.findUnique({ where: { sku: flour.sku } })).toMatchObject({
      description: "Rye flour",
      kind: "GOODS",
      unit: "KILOGRAM",
    });
  });

  it("keeps its own description and GTIN when they are sent unchanged", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_UPDATE]);
    const flour = await createFlour({ gtin: "7891000100103" });

    const response = await patchProduct(headers, flour.sku, { description: "Wheat flour", gtin: "7891000100103" });

    expect(response.statusCode).toBe(200);
  });

  it("recognises the product itself when its sku is written in capitals", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_UPDATE]);
    const flour = await createFlour({ gtin: "7891000100103" });

    const response = await patchProduct(headers, flour.sku.toUpperCase(), { description: "Wheat flour" });

    expect(response.statusCode).toBe(200);
  });

  it("answers 409 for a description another product has, and writes nothing", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_UPDATE]);
    const flour = await createFlour();
    await testPrisma.product.create({ data: { description: "Rye flour", kind: "GOODS", unit: "KILOGRAM" } });

    const response = await patchProduct(headers, flour.sku, { description: "Rye flour", minimumQuantity: "3" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "A product with this description already exists." });
    expect((await testPrisma.product.findUnique({ where: { sku: flour.sku } }))?.description).toBe("Wheat flour");
    expect(await testPrisma.productStock.count()).toBe(0);
  });

  it("answers 409 for a GTIN another product has", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_UPDATE]);
    const flour = await createFlour();
    await testPrisma.product.create({
      data: { description: "Rye flour", kind: "GOODS", unit: "KILOGRAM", gtin: "7891000100103" },
    });

    const response = await patchProduct(headers, flour.sku, { gtin: "7891000100103" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "A product with this GTIN already exists." });
  });

  it("answers 404 for a product that does not exist", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_UPDATE]);

    const response = await patchProduct(headers, UNKNOWN_SKU, { isActive: false });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: "Product not found." });
  });

  it.each([
    ["an empty body", {}],
    ["only fields that cannot change", { kind: "MANUFACTURED", unit: "GRAM" }],
    ["a blank description", { description: "  " }],
    ["a GTIN that is not made of digits", { gtin: "78910001001AB" }],
    ["a minimum quantity of zero", { minimumQuantity: "0" }],
    ["an active flag that is not a boolean", { isActive: "no" }],
  ])("answers 400 for %s", async (_label, payload) => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_UPDATE]);
    const flour = await createFlour();

    expect((await patchProduct(headers, flour.sku, payload)).statusCode).toBe(400);
  });

  it("answers 400 for a sku that is not a uuid", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_UPDATE]);

    expect((await patchProduct(headers, "flour", { isActive: false })).statusCode).toBe(400);
  });

  it("answers 403 without CATALOG_UPDATE", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_CREATE, Permission.CATALOG_READ]);
    const flour = await createFlour();

    expect((await patchProduct(headers, flour.sku, { isActive: false })).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await patchProduct(undefined, UNKNOWN_SKU, { isActive: false })).statusCode).toBe(401);
  });
});
