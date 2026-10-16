import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { Permission } from "../../generated/prisma/index.js";
import { messageSchema } from "../auth/auth.schemas.js";
import {
  findProductByDescription,
  findProductByGtin,
  findProductBySku,
  insertProduct,
  listProducts,
  updateProduct,
} from "./products.repository.js";
import {
  createProductBodySchema,
  productParamsSchema,
  productSchema,
  updateProductBodySchema,
} from "./products.schemas.js";

const DESCRIPTION_TAKEN = { message: "A product with this description already exists." };
const GTIN_TAKEN = { message: "A product with this GTIN already exists." };

// Whether another product than `sku` already holds this description or GTIN. With no `sku`, any does.
async function conflictOf(input: { description?: string; gtin?: string | null }, sku?: string) {
  // The database answers a uuid in lower case, whatever case the request wrote it in.
  const takenBy = (found: { sku: string } | null) => found !== null && found.sku !== sku?.toLowerCase();

  if (input.description !== undefined && takenBy(await findProductByDescription(input.description))) {
    return DESCRIPTION_TAKEN;
  }

  if (input.gtin !== undefined && input.gtin !== null && takenBy(await findProductByGtin(input.gtin))) {
    return GTIN_TAKEN;
  }

  return null;
}

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
      const conflict = await conflictOf(request.body);

      if (conflict !== null) return reply.code(409).send(conflict);

      return reply.code(201).send(await insertProduct(request.body));
    },
  );

  typed.patch(
    "/products/:sku",
    {
      config: { auth: Permission.CATALOG_UPDATE },
      schema: {
        tags: ["products"],
        summary: "Edita a descrição, o GTIN e o estoque mínimo de um produto, ou o inativa e reativa",
        params: productParamsSchema,
        body: updateProductBodySchema,
        response: { 200: productSchema, 404: messageSchema, 409: messageSchema },
      },
    },
    async (request, reply) => {
      const { sku } = request.params;

      if ((await findProductBySku(sku)) === null) {
        return reply.code(404).send({ message: "Product not found." });
      }

      const conflict = await conflictOf(request.body, sku);

      if (conflict !== null) return reply.code(409).send(conflict);

      return reply.send(await updateProduct(sku, request.body));
    },
  );
}
