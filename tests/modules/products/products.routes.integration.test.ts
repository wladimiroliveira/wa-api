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
    const bread = await testPrisma.product.create({
      data: { description: "Bread", kind: "MANUFACTURED", unit: "UNIT", isActive: false },
    });

    const response = await listProducts(headers);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { sku: bread.sku, gtin: null, description: "Bread", kind: "MANUFACTURED", unit: "UNIT", isActive: false },
      {
        sku: flour.sku,
        gtin: "7891000100103",
        description: "Wheat flour",
        kind: "GOODS",
        unit: "KILOGRAM",
        isActive: true,
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

const postProduct = (headers: { authorization: string } | undefined, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/products", headers, payload });

const FLOUR = { description: "Wheat flour", kind: "GOODS", unit: "KILOGRAM" };

describe("POST /v1/products", () => {
  it("registers an active product and answers it with its sku", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_CREATE]);

    const response = await postProduct(headers, { ...FLOUR, gtin: "7891000100103" });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ ...FLOUR, sku: expect.any(String), gtin: "7891000100103", isActive: true });
    expect(await testPrisma.product.findUnique({ where: { sku: response.json().sku } })).toMatchObject(FLOUR);
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
