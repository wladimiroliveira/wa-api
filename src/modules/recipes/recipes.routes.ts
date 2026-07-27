import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  createRecipeSchema,
  updateMarginSchema,
  updateRecipeSchema,
  recipeIdParamSchema,
  type RecipeItemInput,
} from "./recipes.schema.js";
import { assertItemDimension, DimensionMismatchError } from "../shared/dimension.js";
import * as recipeRepo from "./recipes.repository.js";
import { getSupply } from "../supplies/supplies.repository.js";

// Valida a dimensão de cada item contra o insumo referenciado. Retorna `true`
// quando tudo é válido; caso contrário já envia a resposta 400 e retorna `false`.
async function validateItemsDimension(items: RecipeItemInput[], reply: FastifyReply): Promise<boolean> {
  for (const item of items) {
    const supply = await getSupply(item.supplyId);
    if (!supply) {
      reply.status(400).send({ message: `Supply ${item.supplyId} not found` });
      return false;
    }
    try {
      assertItemDimension(supply.purchaseUnit, item.usageUnit);
    } catch (err) {
      if (err instanceof DimensionMismatchError) {
        reply.status(400).send({ code: err.code, message: err.message });
        return false;
      }
      throw err;
    }
  }
  return true;
}

export default async function recipeRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/recipes", async () => recipeRepo.listRecipes());

  r.post("/recipes", { schema: { body: createRecipeSchema } }, async (req, reply) => {
    if (!(await validateItemsDimension(req.body.items, reply))) return;
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

  r.patch(
    "/recipes/:id",
    { schema: { params: recipeIdParamSchema, body: updateRecipeSchema } },
    async (req, reply) => {
      if (req.body.items && !(await validateItemsDimension(req.body.items, reply))) return;
      return recipeRepo.updateRecipe(req.params.id, req.body);
    },
  );

  r.delete("/recipes/:id", { schema: { params: recipeIdParamSchema } }, async (req, reply) => {
    await recipeRepo.deleteRecipe(req.params.id);
    return reply.status(204).send();
  });
}
