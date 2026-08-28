import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { Permission } from "../../generated/prisma/index.js";
import { messageSchema } from "../auth/auth.schemas.js";
import { deleteRole, findRoleById, findRoleByName, insertRole, listRoles, updateRole } from "./roles.repository.js";
import { createRoleBodySchema, roleIdParamsSchema, roleSchema, updateRoleBodySchema } from "./roles.schemas.js";

export default async function rolesRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/roles",
    {
      config: { auth: Permission.ACCESS_READ },
      schema: { tags: ["roles"], summary: "Lista os papéis", response: { 200: z.array(roleSchema) } },
    },
    async (_request, reply) => reply.send(await listRoles()),
  );

  typed.post(
    "/roles",
    {
      config: { auth: Permission.ACCESS_CREATE },
      schema: {
        tags: ["roles"],
        summary: "Cria um papel",
        body: createRoleBodySchema,
        response: { 201: roleSchema, 409: messageSchema },
      },
    },
    async (request, reply) => {
      if ((await findRoleByName(request.body.name)) !== null) {
        return reply.code(409).send({ message: "A role with this name already exists." });
      }

      return reply.code(201).send(await insertRole(request.body));
    },
  );

  typed.patch(
    "/roles/:id",
    {
      config: { auth: Permission.ACCESS_UPDATE },
      schema: {
        tags: ["roles"],
        summary: "Edita o nome e o pacote de permissões",
        params: roleIdParamsSchema,
        body: updateRoleBodySchema,
        response: { 200: roleSchema, 404: messageSchema, 409: messageSchema },
      },
    },
    async (request, reply) => {
      if ((await findRoleById(request.params.id)) === null) {
        return reply.code(404).send({ message: "Role not found." });
      }

      if (request.body.name !== undefined) {
        const sameName = await findRoleByName(request.body.name);

        if (sameName !== null && sameName.id !== request.params.id) {
          return reply.code(409).send({ message: "A role with this name already exists." });
        }
      }

      return reply.send(await updateRole(request.params.id, request.body));
    },
  );

  typed.delete(
    "/roles/:id",
    {
      config: { auth: Permission.ACCESS_UPDATE },
      schema: {
        tags: ["roles"],
        summary: "Remove o papel; seus usuários ficam sem herança",
        params: roleIdParamsSchema,
        response: { 204: z.void(), 404: messageSchema },
      },
    },
    async (request, reply) => {
      if ((await findRoleById(request.params.id)) === null) {
        return reply.code(404).send({ message: "Role not found." });
      }

      await deleteRole(request.params.id);

      return reply.code(204).send();
    },
  );
}
