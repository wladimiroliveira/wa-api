import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { Permission } from "../../generated/prisma/index.js";
import { requirePermission } from "../auth/auth.guard.js";
import { createRoleSchema, roleIdParamSchema, updateRoleSchema } from "./roles.schema.js";
import * as repo from "./roles.repository.js";

export default async function roleRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/roles", { preHandler: requirePermission(Permission.USERS_READ) }, async () => repo.listRoles());

  r.post(
    "/roles",
    { preHandler: requirePermission(Permission.USERS_WRITE), schema: { body: createRoleSchema } },
    async (req, reply) => reply.status(201).send(await repo.createRole(req.body)),
  );

  r.patch(
    "/roles/:id",
    {
      preHandler: requirePermission(Permission.USERS_WRITE),
      schema: { params: roleIdParamSchema, body: updateRoleSchema },
    },
    async (req) => repo.updateRole(req.params.id, req.body),
  );

  r.delete(
    "/roles/:id",
    { preHandler: requirePermission(Permission.USERS_WRITE), schema: { params: roleIdParamSchema } },
    async (req, reply) => {
      await repo.deleteRole(req.params.id);
      return reply.status(204).send();
    },
  );
}
