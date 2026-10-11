import { Prisma } from "../../generated/prisma/index.js";
import { prisma } from "../../lib/prisma.js";

const productSelect = { sku: true, description: true, unit: true } satisfies Prisma.ProductSelect;

const recipeSelect = {
  yieldQuantity: true,
  updatedAt: true,
  product: { select: productSelect },
  ingredients: {
    select: { quantity: true, product: { select: productSelect } },
    orderBy: { product: { description: "asc" } },
  },
} satisfies Prisma.RecipeSelect;

export type RecipeRecord = Prisma.RecipeGetPayload<{ select: typeof recipeSelect }>;

export function findProductsBySku(skus: string[]) {
  return prisma.product.findMany({
    where: { sku: { in: skus } },
    select: { sku: true, kind: true, isActive: true },
  });
}

export function findRecipeByProductSku(productSku: string) {
  return prisma.recipe.findUnique({ where: { productSku }, select: recipeSelect });
}

// Returns null, and writes nothing, when the product would end up inside its own recipe, directly
// or through the recipes of its ingredients. The lock makes the check and the write one step: two
// recipes that point at each other, saved at once, would each pass a check that saw only the past.
export function saveRecipe(input: {
  productSku: string;
  yieldQuantity: string;
  ingredients: { productSku: string; quantity: string }[];
}): Promise<RecipeRecord | null> {
  const { productSku, yieldQuantity, ingredients } = input;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('recipes'))`;

    const [{ isCyclic }] = await tx.$queryRaw<{ isCyclic: boolean }[]>`
      WITH RECURSIVE reachable (product_sku) AS (
        SELECT unnest(${ingredients.map((ingredient) => ingredient.productSku)}::uuid[])
        UNION
        SELECT ingredient.product_sku
        FROM reachable
        JOIN recipes AS recipe ON recipe.product_sku = reachable.product_sku
        JOIN recipe_ingredients AS ingredient ON ingredient.recipe_id = recipe.id
      )
      SELECT EXISTS (SELECT 1 FROM reachable WHERE product_sku = ${productSku}::uuid) AS "isCyclic"
    `;

    if (isCyclic) return null;

    return tx.recipe.upsert({
      where: { productSku },
      create: { productSku, yieldQuantity, ingredients: { create: ingredients } },
      update: { yieldQuantity, ingredients: { deleteMany: {}, create: ingredients } },
      select: recipeSelect,
    });
  });
}
