import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { recipeIdParamSchema } from "../recipes/recipes.schema.js";
import { getRecipeWithItems } from "../recipes/recipes.repository.js";
import { DimensionMismatchError } from "../shared/dimension.js";
import { calculatePricing } from "./pricing.calc.js";
import { requirePermission } from "../auth/auth.guard.js";
import { Permission } from "../../generated/prisma/index.js";
import { errorSchema, protectedErrors } from "../shared/response.js";
import { pricingResponseSchema } from "./pricing.schema.js";

export default async function pricingRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/recipes/:id/pricing",
    {
      preHandler: requirePermission(Permission.PRICING_READ),
      schema: {
        params: recipeIdParamSchema,
        response: { 200: pricingResponseSchema, 404: errorSchema, 409: errorSchema, ...protectedErrors },
      },
    },
    async (req, reply) => {
      const recipe = await getRecipeWithItems(req.params.id);
      if (!recipe) return reply.status(404).send({ message: "Receita não encontrada" });

      let result;
      try {
        result = calculatePricing(recipe);
      } catch (err) {
        if (err instanceof DimensionMismatchError) {
          return reply.status(409).send({ code: err.code, message: err.message });
        }
        throw err;
      }

      // O handler formata cada valor para string (toFixed/toString); na borda,
      // pricingResponseSchema coerce esses valores de volta para number.
      return {
        suppliesCostPerHundred: result.suppliesCostPerHundred.toFixed(2),
        totalCostPerHundred: result.totalCostPerHundred.toFixed(2),
        exactPrice: result.exactPrice.toString(),
        pricePerHundred: result.pricePerHundred.toFixed(2),
        pricePerHalfHundred: result.pricePerHalfHundred.toFixed(2),
      };
    },
  );
}
