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

const MISSING_SKU = "0199a1f0-0000-7000-8000-0000000000ff";

type ProductOverrides = { kind?: ProductKind; unit?: MeasurementUnit; isActive?: boolean };
type Headers = { authorization: string } | undefined;

const createProduct = (description: string, overrides: ProductOverrides = {}) =>
  testPrisma.product.create({ data: { description, kind: "GOODS", unit: "KILOGRAM", ...overrides } });

const createManufactured = (description: string, overrides: ProductOverrides = {}) =>
  createProduct(description, { kind: "MANUFACTURED", ...overrides });

const putRecipe = (headers: Headers, sku: string, payload: Record<string, unknown>) =>
  app.inject({ method: "PUT", url: `/v1/products/${sku}/recipe`, headers, payload });

const getRecipe = (headers: Headers, sku: string) =>
  app.inject({ method: "GET", url: `/v1/products/${sku}/recipe`, headers });

const canUpdate = () => authenticateAs(app, [Permission.CATALOG_UPDATE]);

describe("PUT /v1/products/:sku/recipe", () => {
  it("defines the recipe of a manufactured product", async () => {
    const { headers } = await canUpdate();
    const dough = await createManufactured("Bread dough");
    const flour = await createProduct("Wheat flour");
    const water = await createProduct("Water", { unit: "LITER" });

    const response = await putRecipe(headers, dough.sku, {
      yieldQuantity: "25",
      ingredients: [
        { productSku: flour.sku, quantity: "15.5" },
        { productSku: water.sku, quantity: "9" },
      ],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      product: { sku: dough.sku, description: "Bread dough", unit: "KILOGRAM" },
      yieldQuantity: "25",
      ingredients: [
        { product: { sku: water.sku, description: "Water", unit: "LITER" }, quantity: "9" },
        { product: { sku: flour.sku, description: "Wheat flour", unit: "KILOGRAM" }, quantity: "15.5" },
      ],
    });
    expect(await testPrisma.recipe.count()).toBe(1);
    expect(await testPrisma.recipeIngredient.count()).toBe(2);
  });

  it("replaces the yield and the ingredients of a recipe that already exists", async () => {
    const { headers } = await canUpdate();
    const dough = await createManufactured("Bread dough");
    const flour = await createProduct("Wheat flour");
    const salt = await createProduct("Salt");
    await putRecipe(headers, dough.sku, {
      yieldQuantity: "25",
      ingredients: [{ productSku: flour.sku, quantity: "15" }],
    });

    const response = await putRecipe(headers, dough.sku, {
      yieldQuantity: "50",
      ingredients: [{ productSku: salt.sku, quantity: "0.4" }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      yieldQuantity: "50",
      ingredients: [{ product: { sku: salt.sku }, quantity: "0.4" }],
    });
    expect(await testPrisma.recipe.count()).toBe(1);
    expect(await testPrisma.recipeIngredient.count()).toBe(1);
  });

  it("accepts a manufactured product as an ingredient of another", async () => {
    const { headers } = await canUpdate();
    const bread = await createManufactured("Bread", { unit: "UNIT" });
    const dough = await createManufactured("Bread dough");

    const response = await putRecipe(headers, bread.sku, {
      yieldQuantity: "100",
      ingredients: [{ productSku: dough.sku, quantity: "25" }],
    });

    expect(response.statusCode).toBe(200);
  });

  it("answers 404 for a product that does not exist", async () => {
    const { headers } = await canUpdate();
    const flour = await createProduct("Wheat flour");

    const response = await putRecipe(headers, MISSING_SKU, {
      yieldQuantity: "1",
      ingredients: [{ productSku: flour.sku, quantity: "1" }],
    });

    expect(response.statusCode).toBe(404);
  });

  it.each([
    ["goods, which are bought and not produced", { kind: "GOODS" as const }],
    ["an inactive product", { kind: "MANUFACTURED" as const, isActive: false }],
  ])("answers 409 for %s, and writes nothing", async (_label, overrides) => {
    const { headers } = await canUpdate();
    const product = await createProduct("Bread dough", overrides);
    const flour = await createProduct("Wheat flour");

    const response = await putRecipe(headers, product.sku, {
      yieldQuantity: "1",
      ingredients: [{ productSku: flour.sku, quantity: "1" }],
    });

    expect(response.statusCode).toBe(409);
    expect(await testPrisma.recipe.count()).toBe(0);
  });

  it("answers 404 for an ingredient that does not exist, and writes nothing", async () => {
    const { headers } = await canUpdate();
    const dough = await createManufactured("Bread dough");
    const flour = await createProduct("Wheat flour");

    const response = await putRecipe(headers, dough.sku, {
      yieldQuantity: "1",
      ingredients: [
        { productSku: flour.sku, quantity: "1" },
        { productSku: MISSING_SKU, quantity: "1" },
      ],
    });

    expect(response.statusCode).toBe(404);
    expect(await testPrisma.recipe.count()).toBe(0);
  });

  it("answers 409 for an inactive ingredient, and writes nothing", async () => {
    const { headers } = await canUpdate();
    const dough = await createManufactured("Bread dough");
    const flour = await createProduct("Wheat flour", { isActive: false });

    const response = await putRecipe(headers, dough.sku, {
      yieldQuantity: "1",
      ingredients: [{ productSku: flour.sku, quantity: "1" }],
    });

    expect(response.statusCode).toBe(409);
    expect(await testPrisma.recipe.count()).toBe(0);
  });

  it("answers 409 when the product is its own ingredient", async () => {
    const { headers } = await canUpdate();
    const dough = await createManufactured("Bread dough");

    const response = await putRecipe(headers, dough.sku, {
      yieldQuantity: "1",
      ingredients: [{ productSku: dough.sku, quantity: "1" }],
    });

    expect(response.statusCode).toBe(409);
    expect(await testPrisma.recipe.count()).toBe(0);
  });

  it("answers 409 when the product would end up inside its own recipe through another, and keeps the old recipe", async () => {
    const { headers } = await canUpdate();
    const flour = await createProduct("Wheat flour");
    const dough = await createManufactured("Bread dough");
    const filling = await createManufactured("Filling");
    const bread = await createManufactured("Bread", { unit: "UNIT" });
    await putRecipe(headers, dough.sku, {
      yieldQuantity: "25",
      ingredients: [{ productSku: flour.sku, quantity: "15" }],
    });
    await putRecipe(headers, filling.sku, {
      yieldQuantity: "5",
      ingredients: [{ productSku: dough.sku, quantity: "1" }],
    });
    await putRecipe(headers, bread.sku, {
      yieldQuantity: "10",
      ingredients: [{ productSku: filling.sku, quantity: "2" }],
    });

    const response = await putRecipe(headers, dough.sku, {
      yieldQuantity: "25",
      ingredients: [{ productSku: bread.sku, quantity: "1" }],
    });

    expect(response.statusCode).toBe(409);
    expect((await getRecipeIngredientSkus(dough.sku)).sort()).toEqual([flour.sku]);
  });

  it("never closes a cycle when two recipes that point at each other arrive at once", async () => {
    const { headers } = await canUpdate();
    const dough = await createManufactured("Bread dough");
    const filling = await createManufactured("Filling");

    const responses = await Promise.all([
      putRecipe(headers, dough.sku, { yieldQuantity: "1", ingredients: [{ productSku: filling.sku, quantity: "1" }] }),
      putRecipe(headers, filling.sku, { yieldQuantity: "1", ingredients: [{ productSku: dough.sku, quantity: "1" }] }),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(await testPrisma.recipe.count()).toBe(1);
  });

  it.each([
    ["a zero yield", { yieldQuantity: "0" }],
    ["a yield that is not a decimal", { yieldQuantity: "plenty" }],
    ["a missing yield", { yieldQuantity: undefined }],
    ["no ingredient", { ingredients: [] }],
    ["a zero ingredient quantity", { quantity: "0" }],
    ["an ingredient quantity with more than six decimal places", { quantity: "1.0000001" }],
    ["the same ingredient twice", { repeat: true }],
  ])("answers 400 for %s", async (_label, change: Record<string, unknown>) => {
    const { headers } = await canUpdate();
    const dough = await createManufactured("Bread dough");
    const flour = await createProduct("Wheat flour");
    const ingredient = { productSku: flour.sku, quantity: change.quantity ?? "1" };

    const response = await putRecipe(headers, dough.sku, {
      yieldQuantity: "yieldQuantity" in change ? change.yieldQuantity : "1",
      ingredients: change.ingredients ?? (change.repeat ? [ingredient, ingredient] : [ingredient]),
    });

    expect(response.statusCode).toBe(400);
    expect(await testPrisma.recipe.count()).toBe(0);
  });

  it("answers 403 without CATALOG_UPDATE", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_READ, Permission.CATALOG_CREATE]);

    expect((await putRecipe(headers, MISSING_SKU, { yieldQuantity: "1", ingredients: [] })).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await putRecipe(undefined, MISSING_SKU, { yieldQuantity: "1", ingredients: [] })).statusCode).toBe(401);
  });
});

describe("GET /v1/products/:sku/recipe", () => {
  it("returns the recipe of the product", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_READ, Permission.CATALOG_UPDATE]);
    const dough = await createManufactured("Bread dough");
    const flour = await createProduct("Wheat flour");
    const saved = await putRecipe(headers, dough.sku, {
      yieldQuantity: "25",
      ingredients: [{ productSku: flour.sku, quantity: "15.5" }],
    });

    const response = await getRecipe(headers, dough.sku);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(saved.json());
    expect(response.json()).toMatchObject({
      product: { sku: dough.sku, description: "Bread dough", unit: "KILOGRAM" },
      yieldQuantity: "25",
      ingredients: [{ product: { sku: flour.sku, description: "Wheat flour", unit: "KILOGRAM" }, quantity: "15.5" }],
    });
  });

  it("answers 404 for a product that has no recipe", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_READ]);
    const dough = await createManufactured("Bread dough");

    expect((await getRecipe(headers, dough.sku)).statusCode).toBe(404);
  });

  it("answers 404 for a product that does not exist", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_READ]);

    expect((await getRecipe(headers, MISSING_SKU)).statusCode).toBe(404);
  });

  it("answers 403 without CATALOG_READ", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_UPDATE]);

    expect((await getRecipe(headers, MISSING_SKU)).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await getRecipe(undefined, MISSING_SKU)).statusCode).toBe(401);
  });
});

async function getRecipeIngredientSkus(productSku: string): Promise<string[]> {
  const ingredients = await testPrisma.recipeIngredient.findMany({ where: { recipe: { productSku } } });

  return ingredients.map((ingredient) => ingredient.productSku);
}
