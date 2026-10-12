import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { Permission } from "../../generated/prisma/index.js";
import { messageSchema } from "../auth/auth.schemas.js";
import { findProductByDescription, findProductByGtin, insertProduct, listProducts } from "./products.repository.js";
import { createProductBodySchema, productSchema } from "./products.schemas.js";

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

  typed.post(
    "/products",
    {
      config: { auth: Permission.CATALOG_CREATE },
      schema: {
        tags: ["products"],
        summary: "Cadastra um produto",
        body: createProductBodySchema,
        response: { 201: productSchema, 409: messageSchema },
      },
    },
    async (request, reply) => {
      if ((await findProductByDescription(request.body.description)) !== null) {
        return reply.code(409).send({ message: "A product with this description already exists." });
      }

      if (request.body.gtin !== undefined && (await findProductByGtin(request.body.gtin)) !== null) {
        return reply.code(409).send({ message: "A product with this GTIN already exists." });
      }

      return reply.code(201).send(await insertProduct(request.body));
    },
  );
}
