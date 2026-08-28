import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { applyAccessControl, PUBLIC } from "./modules/auth/auth.access.js";
import { loadAuthenticatedUser } from "./modules/auth/auth.repository.js";
import authRoutes from "./modules/auth/auth.routes.js";

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
}
