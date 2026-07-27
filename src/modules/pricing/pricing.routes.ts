import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { recipeIdParamSchema } from "../recipes/recipes.schema.js";
import { getRecipeWithItems } from "../recipes/recipes.repository.js";
import { DimensionMismatchError } from "../recipes/recipes.validation.js";
import { calculatePricing } from "./pricing.calc.js";

export default async function pricingRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/recipes/:id/pricing", { schema: { params: recipeIdParamSchema } }, async (req, reply) => {
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

    // Serializa os Decimal como string para preservar exatidão na resposta.
    return {
      suppliesCostPerHundred: result.suppliesCostPerHundred.toFixed(2),
      totalCostPerHundred: result.totalCostPerHundred.toFixed(2),
      exactPrice: result.exactPrice.toString(),
      pricePerHundred: result.pricePerHundred.toFixed(2),
      pricePerHalfHundred: result.pricePerHalfHundred.toFixed(2),
    };
  });
}
