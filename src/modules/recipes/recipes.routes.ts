import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  createRecipeSchema,
  updateMarginSchema,
  recipeIdParamSchema,
} from "./recipes.schema.js";
import { assertItemDimension, DimensionMismatchError } from "./recipes.validation.js";
import * as recipeRepo from "./recipes.repository.js";
import { getSupply } from "../supplies/supplies.repository.js";

export default async function recipeRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/recipes", async () => recipeRepo.listRecipes());

  r.post("/recipes", { schema: { body: createRecipeSchema } }, async (req, reply) => {
    // Valida a dimensão de cada item contra o insumo referenciado.
    for (const item of req.body.items) {
      const supply = await getSupply(item.supplyId);
      if (!supply) {
        return reply.status(400).send({ message: `Supply ${item.supplyId} not found` });
      }
      try {
        assertItemDimension(supply.purchaseUnit, item.usageUnit);
      } catch (err) {
        if (err instanceof DimensionMismatchError) {
          return reply.status(400).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    }
    const recipe = await recipeRepo.createRecipe(req.body);
    return reply.status(201).send(recipe);
  });

  r.get("/recipes/:id", { schema: { params: recipeIdParamSchema } }, async (req, reply) => {
    const recipe = await recipeRepo.getRecipeWithItems(req.params.id);
    if (!recipe) return reply.status(404).send({ message: "Recipe not found" });
    return recipe;
  });

  r.patch(
    "/recipes/:id/margin",
    { schema: { params: recipeIdParamSchema, body: updateMarginSchema } },
    async (req) => recipeRepo.updateMargin(req.params.id, req.body.margin),
  );

  r.delete("/recipes/:id", { schema: { params: recipeIdParamSchema } }, async (req, reply) => {
    await recipeRepo.deleteRecipe(req.params.id);
    return reply.status(204).send();
  });
}
