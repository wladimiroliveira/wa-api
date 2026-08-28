import { FastifyInstance, FastifyRequest } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { AUTHENTICATED, PUBLIC } from "./auth.access.js";
import { findUserById } from "./auth.repository.js";
import { login, logout, refreshSession } from "./auth.service.js";
import {
  currentUserSchema,
  loginBodySchema,
  messageSchema,
  refreshBodySchema,
  sessionTokensSchema,
} from "./auth.schemas.js";

const INVALID_CREDENTIALS = { message: "Invalid credentials." };

export default async function authRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    "/sessions",
    {
      config: {
        auth: PUBLIC,
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
          // The hook runs after the body is parsed so the key can include the username: limiting by
          // IP alone lets one office share the budget, and by username alone lets one IP sweep every
          // account.
          hook: "preHandler",
          keyGenerator: (request: FastifyRequest) => {
            const body = request.body as { username?: string } | null;

            return `${request.ip}:${body?.username ?? ""}`;
          },
        },
      },
      schema: {
        tags: ["auth"],
        summary: "Autentica e devolve o par de tokens",
        body: loginBodySchema,
        response: { 200: sessionTokensSchema, 401: messageSchema },
      },
    },
    async (request, reply) => {
      const tokens = await login(app, request.body);

      // The same answer for an unknown username and for a wrong password: telling them apart would
      // turn the login route into a directory of who exists.
      if (tokens === null) return reply.code(401).send(INVALID_CREDENTIALS);

      return reply.send(tokens);
    },
  );

  typed.post(
    "/sessions/refresh",
    {
      config: { auth: PUBLIC },
      schema: {
        tags: ["auth"],
        summary: "Rotaciona o par de tokens",
        body: refreshBodySchema,
        response: { 200: sessionTokensSchema, 401: messageSchema },
      },
    },
    async (request, reply) => {
      const tokens = await refreshSession(app, request.body.refreshToken);

      if (tokens === null) return reply.code(401).send(INVALID_CREDENTIALS);

      return reply.send(tokens);
    },
  );

  typed.delete(
    "/sessions",
    {
      config: { auth: AUTHENTICATED },
      schema: {
        tags: ["auth"],
        summary: "Encerra a sessão, revogando o refresh token",
        body: refreshBodySchema,
        response: { 204: z.void() },
      },
    },
    async (request, reply) => {
      await logout(request.body.refreshToken);

      return reply.code(204).send();
    },
  );

  typed.get(
    "/me",
    {
      config: { auth: AUTHENTICATED },
      schema: {
        tags: ["auth"],
        summary: "Usuário atual e suas permissões efetivas",
        response: { 200: currentUserSchema },
      },
    },
    async (request, reply) => {
      const current = request.currentUser!;
      const user = await findUserById(current.id);

      return reply.send({
        id: current.id,
        name: user!.name,
        username: user!.username,
        roleId: user!.roleId,
        permissions: current.permissions,
      });
    },
  );
}
