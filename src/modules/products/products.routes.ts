import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { Permission } from "../../generated/prisma/index.js";
import { listProducts } from "./products.repository.js";
import { productSchema } from "./products.schemas.js";

export default async function productsRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/products",
    {
      config: { auth: Permission.CATALOG_READ },
      schema: { tags: ["products"], summary: "Lista os produtos", response: { 200: z.array(productSchema) } },
    },
    async (_request, reply) => reply.send(await listProducts()),
  );
}
