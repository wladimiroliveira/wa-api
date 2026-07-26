import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getRecipeWithItems } from "../recipes/recipes.repository.js";
import { calculatePricing } from "./pricing.calc.js";

const recipeIdParamSchema = z.object({ id: z.string().uuid() });

export default async function pricingRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/recipes/:id/pricing", { schema: { params: recipeIdParamSchema } }, async (req, reply) => {
    const recipe = await getRecipeWithItems(req.params.id);
    if (!recipe) return reply.status(404).send({ message: "Recipe not found" });

    const result = calculatePricing(recipe);

    // Serializa os Decimal como string para preservar exatidão na resposta.
    return {
      suppliesCostPerHundred: result.suppliesCostPerHundred.toFixed(2),
      totalCostPerHundred: result.totalCostPerHundred.toFixed(2),
      exactPrice: result.exactPrice.toFixed(2),
      pricePerHundred: result.pricePerHundred.toFixed(2),
      pricePerHalfHundred: result.pricePerHalfHundred.toFixed(2),
    };
  });
}
