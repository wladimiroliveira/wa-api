import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { Permission, Role, User } from "../../generated/prisma/index.js";
import {
  findUserById,
  findUserByUsername,
  revokeAllRefreshTokens,
  updatePasswordHash,
} from "../auth/auth.repository.js";
import { hashPassword } from "../auth/auth.password.js";
import { effectivePermissions } from "../auth/auth.permissions.js";
import { messageSchema } from "../auth/auth.schemas.js";
import { findRoleById } from "../roles/roles.repository.js";
import { insertUser, listUsers, updateUser } from "./users.repository.js";
import {
  createUserBodySchema,
  resetPasswordBodySchema,
  updateUserBodySchema,
  userIdParamsSchema,
  userSchema,
} from "./users.schemas.js";

type UserWithRole = User & { role: Role | null };

function present(user: UserWithRole) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    roleId: user.roleId,
    extraPermissions: user.extraPermissions,
    permissions: effectivePermissions({
      rolePermissions: user.role?.permissions ?? [],
      extraPermissions: user.extraPermissions,
    }),
    isActive: user.isActive,
  };
}

export default async function usersRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/users",
    {
      config: { auth: Permission.ACCESS_READ },
      schema: { tags: ["users"], summary: "Lista os usuários", response: { 200: z.array(userSchema) } },
    },
    async (_request, reply) => reply.send((await listUsers()).map(present)),
  );

  typed.post(
    "/users",
    {
      config: { auth: Permission.ACCESS_CREATE },
      schema: {
        tags: ["users"],
        summary: "Cria um usuário",
        body: createUserBodySchema,
        response: { 201: userSchema, 404: messageSchema, 409: messageSchema },
      },
    },
    async (request, reply) => {
      const { password, ...rest } = request.body;

      if ((await findUserByUsername(rest.username)) !== null) {
        return reply.code(409).send({ message: "A user with this username already exists." });
      }

      if (rest.roleId != null && (await findRoleById(rest.roleId)) === null) {
        return reply.code(404).send({ message: "Role not found." });
      }

      const created = await insertUser({ ...rest, passwordHash: await hashPassword(password) });

      return reply.code(201).send(present(created));
    },
  );

  typed.get(
    "/users/:id",
    {
      config: { auth: Permission.ACCESS_READ },
      schema: {
        tags: ["users"],
        summary: "Cadastro e permissões efetivas",
        params: userIdParamsSchema,
        response: { 200: userSchema, 404: messageSchema },
      },
    },
    async (request, reply) => {
      const user = await findUserById(request.params.id);

      if (user === null) return reply.code(404).send({ message: "User not found." });

      return reply.send(present(user));
    },
  );

  typed.patch(
    "/users/:id",
    {
      config: { auth: Permission.ACCESS_UPDATE },
      schema: {
        tags: ["users"],
        summary: "Edita papel, permissões avulsas, nome e situação",
        params: userIdParamsSchema,
        body: updateUserBodySchema,
        response: { 200: userSchema, 404: messageSchema },
      },
    },
    async (request, reply) => {
      const user = await findUserById(request.params.id);

      if (user === null) return reply.code(404).send({ message: "User not found." });

      if (request.body.roleId != null && (await findRoleById(request.body.roleId)) === null) {
        return reply.code(404).send({ message: "Role not found." });
      }

      const updated = await updateUser(request.params.id, request.body);

      // Deactivating has to cut the access that is already in someone's hands, not only the next
      // login. Without this, a refresh token keeps the account alive for its full lifetime.
      if (request.body.isActive === false) await revokeAllRefreshTokens(user.id);

      return reply.send(present(updated));
    },
  );

  typed.patch(
    "/users/:id/password",
    {
      config: { auth: Permission.ACCESS_UPDATE },
      schema: {
        tags: ["users"],
        summary: "Reseta a senha de outro usuário",
        params: userIdParamsSchema,
        body: resetPasswordBodySchema,
        response: { 204: z.void(), 404: messageSchema },
      },
    },
    async (request, reply) => {
      const user = await findUserById(request.params.id);

      if (user === null) return reply.code(404).send({ message: "User not found." });

      await updatePasswordHash(user.id, await hashPassword(request.body.newPassword));
      await revokeAllRefreshTokens(user.id);

      return reply.code(204).send();
    },
  );
}
