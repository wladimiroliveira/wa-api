import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { Permission } from "../../generated/prisma/index.js";
import { requirePermission } from "../auth/auth.guard.js";
import { errorSchema, noContentSchema, protectedErrors } from "../shared/response.js";
import {
  createRoleSchema,
  roleIdParamSchema,
  roleListResponseSchema,
  roleResponseSchema,
  updateRoleSchema,
} from "./roles.schema.js";
import * as repo from "./roles.repository.js";

export default async function roleRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/roles",
    {
      preHandler: requirePermission(Permission.USERS_READ),
      schema: { response: { 200: roleListResponseSchema, ...protectedErrors } },
    },
    async () => repo.listRoles(),
  );

  r.post(
    "/roles",
    {
      preHandler: requirePermission(Permission.USERS_WRITE),
      schema: {
        body: createRoleSchema,
        response: { 201: roleResponseSchema, 400: errorSchema, 409: errorSchema, ...protectedErrors },
      },
    },
    async (req, reply) => reply.status(201).send(await repo.createRole(req.body)),
  );

  r.patch(
    "/roles/:id",
    {
      preHandler: requirePermission(Permission.USERS_WRITE),
      schema: {
        params: roleIdParamSchema,
        body: updateRoleSchema,
        response: {
          200: roleResponseSchema,
          400: errorSchema,
          404: errorSchema,
          409: errorSchema,
          ...protectedErrors,
        },
      },
    },
    async (req) => repo.updateRole(req.params.id, req.body),
  );

  r.delete(
    "/roles/:id",
    {
      preHandler: requirePermission(Permission.USERS_WRITE),
      schema: {
        params: roleIdParamSchema,
        response: { 204: noContentSchema, 404: errorSchema, 409: errorSchema, ...protectedErrors },
      },
    },
    async (req, reply) => {
      await repo.deleteRole(req.params.id);
      return reply.status(204).send();
    },
  );
}
