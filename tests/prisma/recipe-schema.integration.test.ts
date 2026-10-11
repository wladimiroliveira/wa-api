import { afterAll, afterEach, describe, expect, it } from "vitest";
import { resetDatabase, testPrisma } from "../support/database.js";

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createProduct = (description: string, kind: "GOODS" | "MANUFACTURED" = "GOODS") =>
  testPrisma.product.create({ data: { description, kind, unit: "KILOGRAM" } });

const createRecipe = async (yieldQuantity = "25") => {
  const product = await createProduct("Bread dough", "MANUFACTURED");

  return testPrisma.recipe.create({ data: { productSku: product.sku, yieldQuantity } });
};

describe("recipes", () => {
  it("holds a single recipe per product", async () => {
    const recipe = await createRecipe();

    await expect(
      testPrisma.recipe.create({ data: { productSku: recipe.productSku, yieldQuantity: "10" } }),
    ).rejects.toThrow();
  });

  it("rejects a yield that is not positive", async () => {
    await expect(createRecipe("0")).rejects.toThrow(/ck_recipes_yield_quantity_positive/);
  });

  it("refuses to delete a product that has a recipe", async () => {
    const recipe = await createRecipe();

    await expect(testPrisma.product.delete({ where: { sku: recipe.productSku } })).rejects.toThrow();
  });
});

describe("recipe_ingredients", () => {
  it("records how much of a product the recipe takes", async () => {
    const [recipe, flour] = await Promise.all([createRecipe(), createProduct("Wheat flour")]);

    const ingredient = await testPrisma.recipeIngredient.create({
      data: { recipeId: recipe.id, productSku: flour.sku, quantity: "15.5" },
    });

    expect(ingredient).toMatchObject({ recipeId: recipe.id, productSku: flour.sku });
    expect(ingredient.quantity.toString()).toBe("15.5");
  });

  it("rejects a quantity that is not positive", async () => {
    const [recipe, flour] = await Promise.all([createRecipe(), createProduct("Wheat flour")]);

    await expect(
      testPrisma.recipeIngredient.create({ data: { recipeId: recipe.id, productSku: flour.sku, quantity: "0" } }),
    ).rejects.toThrow(/ck_recipe_ingredients_quantity_positive/);
  });

  it("rejects the same product twice in a recipe", async () => {
    const [recipe, flour] = await Promise.all([createRecipe(), createProduct("Wheat flour")]);
    const data = { recipeId: recipe.id, productSku: flour.sku, quantity: "1" };
    await testPrisma.recipeIngredient.create({ data });

    await expect(testPrisma.recipeIngredient.create({ data })).rejects.toThrow();
  });

  it("refuses to delete a product a recipe uses", async () => {
    const [recipe, flour] = await Promise.all([createRecipe(), createProduct("Wheat flour")]);
    await testPrisma.recipeIngredient.create({ data: { recipeId: recipe.id, productSku: flour.sku, quantity: "1" } });

    await expect(testPrisma.product.delete({ where: { sku: flour.sku } })).rejects.toThrow();
  });

  it("goes away with its recipe", async () => {
    const [recipe, flour] = await Promise.all([createRecipe(), createProduct("Wheat flour")]);
    await testPrisma.recipeIngredient.create({ data: { recipeId: recipe.id, productSku: flour.sku, quantity: "1" } });

    await testPrisma.recipe.delete({ where: { id: recipe.id } });

    expect(await testPrisma.recipeIngredient.count()).toBe(0);
  });
});
