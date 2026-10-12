import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { Permission } from "../../generated/prisma/index.js";
import { messageSchema } from "../auth/auth.schemas.js";
import { findSupplierByName, insertSupplier, listSuppliers } from "./suppliers.repository.js";
import { createSupplierBodySchema, supplierSchema } from "./suppliers.schemas.js";

export default async function suppliersRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/suppliers",
    {
      config: { auth: Permission.CATALOG_READ },
      schema: { tags: ["suppliers"], summary: "Lista os fornecedores", response: { 200: z.array(supplierSchema) } },
    },
    async (_request, reply) => reply.send(await listSuppliers()),
  );

  typed.post(
    "/suppliers",
    {
      config: { auth: Permission.CATALOG_CREATE },
      schema: {
        tags: ["suppliers"],
        summary: "Cadastra um fornecedor",
        body: createSupplierBodySchema,
        response: { 201: supplierSchema, 409: messageSchema },
      },
    },
    async (request, reply) => {
      if ((await findSupplierByName(request.body.name)) !== null) {
        return reply.code(409).send({ message: "A supplier with this name already exists." });
      }

      return reply.code(201).send(await insertSupplier(request.body));
    },
  );
}
