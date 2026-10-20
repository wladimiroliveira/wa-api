import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { applyAccessControl, PUBLIC } from "./modules/auth/auth.access.js";
import { loadAuthenticatedUser } from "./modules/auth/auth.repository.js";
import authRoutes from "./modules/auth/auth.routes.js";
import entriesRoutes from "./modules/entries/entries.routes.js";
import lossesRoutes from "./modules/losses/losses.routes.js";
import preWeighingsRoutes from "./modules/pre-weighings/pre-weighings.routes.js";
import productionsRoutes from "./modules/productions/productions.routes.js";
import productsRoutes from "./modules/products/products.routes.js";
import recipesRoutes from "./modules/recipes/recipes.routes.js";
import rolesRoutes from "./modules/roles/roles.routes.js";
import stockRoutes from "./modules/stock/stock.routes.js";
import suppliersRoutes from "./modules/suppliers/suppliers.routes.js";
import tableLayoutsRoutes from "./modules/table-layouts/table-layouts.routes.js";
import usersRoutes from "./modules/users/users.routes.js";

export default async function (app: FastifyInstance) {
  applyAccessControl(app, loadAuthenticatedUser);

  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/health",
    {
      config: { auth: PUBLIC },
      schema: { tags: ["health"], summary: "Saúde do serviço", response: { 200: z.object({ status: z.string() }) } },
    },
    async () => ({ status: "ok" }),
  );

  await app.register(authRoutes);
  await app.register(rolesRoutes);
  await app.register(usersRoutes);
  await app.register(productsRoutes);
  await app.register(suppliersRoutes);
  await app.register(entriesRoutes);
  await app.register(stockRoutes);
  await app.register(lossesRoutes);
  await app.register(recipesRoutes);
  await app.register(preWeighingsRoutes);
  await app.register(productionsRoutes);
  await app.register(tableLayoutsRoutes);
}
