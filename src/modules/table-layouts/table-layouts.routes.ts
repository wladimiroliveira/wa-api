import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { AUTHENTICATED } from "../auth/auth.access.js";
import { deleteTableLayout, listTableLayouts, saveTableLayout } from "./table-layouts.repository.js";
import { tableKeyParamsSchema, tableLayoutBodySchema, tableLayoutSchema } from "./table-layouts.schemas.js";

// Each user arranges only their own tables, so every route reads and writes under the user signed in.
export default async function tableLayoutsRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/sessions/me/table-layouts",
    {
      config: { auth: AUTHENTICATED },
      schema: {
        tags: ["table-layouts"],
        summary: "Lista a disposição das colunas que o usuário deu às tabelas",
        response: { 200: z.array(tableLayoutSchema) },
      },
    },
    async (request, reply) => reply.send(await listTableLayouts(request.currentUser!.id)),
  );

  typed.put(
    "/sessions/me/table-layouts/:tableKey",
    {
      config: { auth: AUTHENTICATED },
      schema: {
        tags: ["table-layouts"],
        summary: "Grava a ordem e a largura das colunas de uma tabela",
        params: tableKeyParamsSchema,
        body: tableLayoutBodySchema,
        response: { 200: tableLayoutSchema },
      },
    },
    async (request, reply) =>
      reply.send(await saveTableLayout(request.currentUser!.id, request.params.tableKey, request.body)),
  );

  typed.delete(
    "/sessions/me/table-layouts/:tableKey",
    {
      config: { auth: AUTHENTICATED },
      schema: {
        tags: ["table-layouts"],
        summary: "Devolve uma tabela à disposição original das colunas",
        params: tableKeyParamsSchema,
        response: { 204: z.void() },
      },
    },
    async (request, reply) => {
      await deleteTableLayout(request.currentUser!.id, request.params.tableKey);

      return reply.code(204).send();
    },
  );
}
