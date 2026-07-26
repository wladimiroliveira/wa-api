import { FastifyInstance } from "fastify";
import supplyRoutes from "./modules/supplies/supplies.routes.js";
import recipeRoutes from "./modules/recipes/recipes.routes.js";
import pricingRoutes from "./modules/pricing/pricing.routes.js";

export default async function (app: FastifyInstance) {
  await app.register(supplyRoutes);
  await app.register(recipeRoutes);
  await app.register(pricingRoutes);
}
