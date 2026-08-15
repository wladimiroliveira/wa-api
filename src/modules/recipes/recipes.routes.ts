import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  createRecipeSchema,
  updateMarginSchema,
  updateRecipeSchema,
  recipeIdParamSchema,
  recipeResponseSchema,
  recipeListResponseSchema,
  recipeWithItemsResponseSchema,
  recipeDetailResponseSchema,
  type RecipeItemInput,
} from "./recipes.schema.js";
import { assertItemDimension, DimensionMismatchError } from "../shared/dimension.js";
import * as recipeRepo from "./recipes.repository.js";
import { getSuppliesByIds } from "../supplies/supplies.repository.js";
import { requirePermission } from "../auth/auth.guard.js";
import { Permission } from "../../generated/prisma/index.js";
import { errorSchema, noContentSchema, protectedErrors } from "../shared/response.js";

// Valida a dimensão de cada item contra o insumo referenciado. Busca todos os
// supplies de uma vez (evita N+1). Retorna `true` quando tudo é válido; caso
// contrário já envia a resposta 400 e retorna `false`.
async function validateItemsDimension(items: RecipeItemInput[], reply: FastifyReply): Promise<boolean> {
  const supplies = await getSuppliesByIds(items.map((item) => item.supplyId));
  const suppliesById = new Map(supplies.map((supply) => [supply.id, supply]));

  for (const item of items) {
    const supply = suppliesById.get(item.supplyId);
    if (!supply) {
      reply.status(400).send({ message: `Insumo ${item.supplyId} não encontrado` });
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

  r.get(
    "/recipes",
    {
      preHandler: requirePermission(Permission.RECIPES_READ),
      schema: { response: { 200: recipeListResponseSchema, ...protectedErrors } },
    },
    async () => recipeRepo.listRecipes(),
  );

  r.post(
    "/recipes",
    {
      preHandler: requirePermission(Permission.RECIPES_WRITE),
      schema: {
        body: createRecipeSchema,
        response: { 201: recipeWithItemsResponseSchema, 400: errorSchema, ...protectedErrors },
      },
    },
    async (req, reply) => {
      if (!(await validateItemsDimension(req.body.items, reply))) return;
      const recipe = await recipeRepo.createRecipe(req.body);
      return reply.status(201).send(recipe);
    },
  );

  r.get(
    "/recipes/:id",
    {
      preHandler: requirePermission(Permission.RECIPES_READ),
      schema: {
        params: recipeIdParamSchema,
        response: { 200: recipeDetailResponseSchema, 404: errorSchema, ...protectedErrors },
      },
    },
    async (req, reply) => {
      const recipe = await recipeRepo.getRecipeWithItems(req.params.id);
      if (!recipe) return reply.status(404).send({ message: "Receita não encontrada" });
      return recipe;
    },
  );

  r.patch(
    "/recipes/:id/margin",
    {
      preHandler: requirePermission(Permission.RECIPES_WRITE),
      schema: {
        params: recipeIdParamSchema,
        body: updateMarginSchema,
        response: { 200: recipeResponseSchema, 400: errorSchema, 404: errorSchema, ...protectedErrors },
      },
    },
    async (req) => recipeRepo.updateMargin(req.params.id, req.body.margin),
  );

  r.patch(
    "/recipes/:id",
    {
      preHandler: requirePermission(Permission.RECIPES_WRITE),
      schema: {
        params: recipeIdParamSchema,
        body: updateRecipeSchema,
        response: { 200: recipeWithItemsResponseSchema, 400: errorSchema, 404: errorSchema, ...protectedErrors },
      },
    },
    async (req, reply) => {
      if (req.body.items && !(await validateItemsDimension(req.body.items, reply))) return;
      return recipeRepo.updateRecipe(req.params.id, req.body);
    },
  );

  r.delete(
    "/recipes/:id",
    {
      preHandler: requirePermission(Permission.RECIPES_WRITE),
      schema: {
        params: recipeIdParamSchema,
        response: { 204: noContentSchema, 404: errorSchema, 409: errorSchema, ...protectedErrors },
      },
    },
    async (req, reply) => {
      await recipeRepo.deleteRecipe(req.params.id);
      return reply.status(204).send();
    },
  );
}
