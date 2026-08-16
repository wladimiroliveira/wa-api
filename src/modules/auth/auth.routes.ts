import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { fastifyRateLimit } from "@fastify/rate-limit";
import {
  changePasswordSchema,
  createSessionSchema,
  meResponseSchema,
  refreshSessionSchema,
  sessionResponseSchema,
} from "./auth.schema.js";
import { loadAuthConfig } from "./auth.config.js";
import { requireAuth } from "./auth.guard.js";
import {
  authenticate,
  changePassword,
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  InvalidCredentialsError,
  InvalidCurrentPasswordError,
  InvalidRefreshTokenError,
} from "./auth.service.js";
import {
  REFRESH_COOKIE,
  clearSessionCookies,
  hasValidCsrfToken,
  setSessionCookies,
  wantsBodyDelivery,
} from "./auth.cookies.js";
import { errorSchema, noContentSchema, protectedErrors } from "../shared/response.js";

const MISSING_CSRF_TOKEN = "Requisição sem token anti-CSRF válido";

export default async function authRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { accessTokenTtl, loginRateLimitMax, refreshRateLimitMax } = loadAuthConfig();

  await app.register(fastifyRateLimit, { global: false });

  const signAccessToken = (userId: string) => app.jwt.sign({ sub: userId }, { expiresIn: accessTokenTtl });

  r.post(
    "/sessions",
    {
      config: { public: true, rateLimit: { max: loginRateLimitMax, timeWindow: "15 minutes" } },
      schema: {
        body: createSessionSchema,
        security: [],
        response: { 200: sessionResponseSchema, 400: errorSchema, 401: errorSchema, 429: errorSchema },
      },
    },
    async (req, reply) => {
      try {
        const user = await authenticate(req.body.username, req.body.password);
        const accessToken = signAccessToken(user.id);
        const refreshToken = await issueRefreshToken(user.id);

        if (wantsBodyDelivery(req)) return { accessToken, refreshToken };

        setSessionCookies(reply, refreshToken);

        return { accessToken };
      } catch (err) {
        if (err instanceof InvalidCredentialsError) return reply.status(401).send({ message: err.message });
        throw err;
      }
    },
  );

  r.post(
    "/sessions/refresh",
    {
      // Bucket próprio, separado do login: o navegador chama esta rota sozinho,
      // a cada recarga de página, e não pode gastar a cota de quem digita senha.
      config: { public: true, rateLimit: { max: refreshRateLimitMax, timeWindow: "15 minutes" } },
      schema: {
        body: refreshSessionSchema,
        security: [{ RefreshCookie: [] }],
        response: {
          200: sessionResponseSchema,
          400: errorSchema,
          401: errorSchema,
          403: errorSchema,
          429: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const bodyToken = req.body?.refreshToken;
      const token = bodyToken ?? req.cookies[REFRESH_COOKIE];

      if (!token) return reply.status(401).send({ message: new InvalidRefreshTokenError().message });
      // Só o cookie viaja sozinho no request forjado; o token no corpo não.
      if (!bodyToken && !hasValidCsrfToken(req)) return reply.status(403).send({ message: MISSING_CSRF_TOKEN });

      try {
        const rotated = await rotateRefreshToken(token);
        const accessToken = signAccessToken(rotated.userId);

        // A entrega segue por onde o token chegou: cookie nunca vira string no corpo.
        if (bodyToken) return { accessToken, refreshToken: rotated.refreshToken };

        setSessionCookies(reply, rotated.refreshToken);

        return { accessToken };
      } catch (err) {
        if (err instanceof InvalidRefreshTokenError) return reply.status(401).send({ message: err.message });
        throw err;
      }
    },
  );

  r.delete(
    "/sessions",
    {
      preHandler: requireAuth(),
      schema: {
        body: refreshSessionSchema,
        response: { 204: noContentSchema, 400: errorSchema, 401: errorSchema, 403: errorSchema },
      },
    },
    async (req, reply) => {
      const bodyToken = req.body?.refreshToken;
      const token = bodyToken ?? req.cookies[REFRESH_COOKIE];

      if (!token) return reply.status(400).send({ message: "Refresh token ausente no corpo e no cookie" });
      if (!bodyToken && !hasValidCsrfToken(req)) return reply.status(403).send({ message: MISSING_CSRF_TOKEN });

      await revokeRefreshToken(token, req.auth.user.id);

      if (!bodyToken) clearSessionCookies(reply);

      return reply.status(204).send();
    },
  );

  r.get(
    "/me",
    { preHandler: requireAuth(), schema: { response: { 200: meResponseSchema, 401: errorSchema } } },
    async (req) => ({
      ...req.auth.user,
      permissions: [...req.auth.permissions],
    }),
  );

  r.patch(
    "/me/password",
    {
      preHandler: requireAuth(),
      // Mesmo teto do login, em balde próprio: também aceita chute de senha.
      config: { rateLimit: { max: loginRateLimitMax, timeWindow: "15 minutes" } },
      schema: {
        body: changePasswordSchema,
        response: { 204: noContentSchema, 400: errorSchema, 429: errorSchema, ...protectedErrors },
      },
    },
    async (req, reply) => {
      try {
        await changePassword(req.auth.user.id, req.body.currentPassword, req.body.newPassword);
      } catch (err) {
        // 403, não 401: o token é válido: quem errou foi a senha. Um 401 aqui
        // mandaria o cliente tentar renovar a sessão sem motivo nenhum.
        if (err instanceof InvalidCurrentPasswordError) return reply.status(403).send({ message: err.message });
        throw err;
      }

      // Toda sessão cai, inclusive esta: o cookie desta some junto com as outras.
      clearSessionCookies(reply);

      return reply.status(204).send();
    },
  );
}
