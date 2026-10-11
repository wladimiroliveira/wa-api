import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { Permission, ProductKind } from "../../generated/prisma/index.js";
import { messageSchema } from "../auth/auth.schemas.js";
import { findProductsBySku, findRecipeByProductSku, RecipeRecord, saveRecipe } from "./recipes.repository.js";
import { recipeParamsSchema, recipeSchema, saveRecipeBodySchema } from "./recipes.schemas.js";

const toResponse = (recipe: RecipeRecord) => ({
  product: recipe.product,
  yieldQuantity: recipe.yieldQuantity.toString(),
  ingredients: recipe.ingredients.map(({ product, quantity }) => ({ product, quantity: quantity.toString() })),
  updatedAt: recipe.updatedAt.toISOString(),
});

export default async function recipesRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/products/:sku/recipe",
    {
      config: { auth: Permission.CATALOG_READ },
      schema: {
        tags: ["recipes"],
        summary: "Consulta a receita de um produto",
        params: recipeParamsSchema,
        response: { 200: recipeSchema, 404: messageSchema },
      },
    },
    async (request, reply) => {
      const recipe = await findRecipeByProductSku(request.params.sku);

      if (recipe === null) {
        return reply.code(404).send({ message: "Recipe not found." });
      }

      return reply.send(toResponse(recipe));
    },
  );

  typed.put(
    "/products/:sku/recipe",
    {
      config: { auth: Permission.CATALOG_UPDATE },
      schema: {
        tags: ["recipes"],
        summary: "Define ou substitui a receita de um produto fabricado",
        params: recipeParamsSchema,
        body: saveRecipeBodySchema,
        response: { 200: recipeSchema, 404: messageSchema, 409: messageSchema },
      },
    },
    async (request, reply) => {
      const productSku = request.params.sku;
      const [product] = await findProductsBySku([productSku]);

      if (product === undefined) {
        return reply.code(404).send({ message: "Product not found." });
      }

      if (!product.isActive) {
        return reply.code(409).send({ message: "Product is inactive." });
      }

      if (product.kind !== ProductKind.MANUFACTURED) {
        return reply.code(409).send({ message: "Only a manufactured product has a recipe." });
      }

      const { ingredients } = request.body;
      const ingredientProducts = await findProductsBySku(ingredients.map((ingredient) => ingredient.productSku));

      if (ingredientProducts.length !== ingredients.length) {
        return reply.code(404).send({ message: "Ingredient product not found." });
      }

      if (ingredientProducts.some((ingredient) => !ingredient.isActive)) {
        return reply.code(409).send({ message: "Ingredient product is inactive." });
      }

      const recipe = await saveRecipe({ productSku, ...request.body });

      if (recipe === null) {
        return reply
          .code(409)
          .send({ message: "A product cannot be an ingredient of itself, directly or through another recipe." });
      }

      return reply.send(toResponse(recipe));
    },
  );
}
