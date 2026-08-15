import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { Permission } from "../../generated/prisma/index.js";
import { requirePermission } from "../auth/auth.guard.js";
import { effectivePermissions } from "../auth/auth.permissions.js";
import { revokeAllRefreshTokens } from "../auth/auth.repository.js";
import { errorSchema, protectedErrors } from "../shared/response.js";
import {
  createUserSchema,
  updateUserSchema,
  userIdParamSchema,
  userListResponseSchema,
  userPermissionsResponseSchema,
  userResponseSchema,
} from "./users.schema.js";
import * as repo from "./users.repository.js";

export default async function userRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/users",
    {
      preHandler: requirePermission(Permission.USERS_READ),
      schema: { response: { 200: userListResponseSchema, ...protectedErrors } },
    },
    async () => repo.listUsers(),
  );

  r.post(
    "/users",
    {
      preHandler: requirePermission(Permission.USERS_WRITE),
      schema: {
        body: createUserSchema,
        response: { 201: userResponseSchema, 400: errorSchema, 409: errorSchema, ...protectedErrors },
      },
    },
    async (req, reply) => reply.status(201).send(await repo.createUser(req.body)),
  );

  r.get(
    "/users/:id",
    {
      preHandler: requirePermission(Permission.USERS_READ),
      schema: {
        params: userIdParamSchema,
        response: { 200: userResponseSchema, 404: errorSchema, ...protectedErrors },
      },
    },
    async (req, reply) => {
      const user = await repo.getUser(req.params.id);
      if (!user) return reply.status(404).send({ message: "Usuário não encontrado" });
      return user;
    },
  );

  r.patch(
    "/users/:id",
    {
      preHandler: requirePermission(Permission.USERS_WRITE),
      schema: {
        params: userIdParamSchema,
        body: updateUserSchema,
        response: {
          200: userResponseSchema,
          400: errorSchema,
          404: errorSchema,
          409: errorSchema,
          ...protectedErrors,
        },
      },
    },
    async (req) => {
      const user = await repo.updateUser(req.params.id, req.body);

      // Desativar corta o acesso no request seguinte; a sessão longa morre junto.
      if (req.body.isActive === false) await revokeAllRefreshTokens(user.id);

      return user;
    },
  );

  r.get(
    "/users/:id/permissions",
    {
      preHandler: requirePermission(Permission.USERS_READ),
      schema: {
        params: userIdParamSchema,
        response: { 200: userPermissionsResponseSchema, 404: errorSchema, ...protectedErrors },
      },
    },
    async (req, reply) => {
      const user = await repo.getUserWithRole(req.params.id);
      if (!user) return reply.status(404).send({ message: "Usuário não encontrado" });

      const permissions = effectivePermissions({
        rolePermissions: user.role?.permissions ?? [],
        grantedPermissions: user.grantedPermissions,
        deniedPermissions: user.deniedPermissions,
      });

      return { userId: user.id, permissions: [...permissions] };
    },
  );
}
