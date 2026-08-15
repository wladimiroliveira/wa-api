import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { fastifyRateLimit } from "@fastify/rate-limit";
import { createSessionSchema, refreshSessionSchema } from "./auth.schema.js";
import { loadAuthConfig } from "./auth.config.js";
import { requireAuth } from "./auth.guard.js";
import {
  authenticate,
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
} from "./auth.service.js";

export default async function authRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { accessTokenTtl, loginRateLimitMax } = loadAuthConfig();

  await app.register(fastifyRateLimit, { global: false });

  const signAccessToken = (userId: string) => app.jwt.sign({ sub: userId }, { expiresIn: accessTokenTtl });

  r.post(
    "/sessions",
    {
      config: { public: true, rateLimit: { max: loginRateLimitMax, timeWindow: "15 minutes" } },
      schema: { body: createSessionSchema, security: [] },
    },
    async (req, reply) => {
      try {
        const user = await authenticate(req.body.username, req.body.password);

        return { accessToken: signAccessToken(user.id), refreshToken: await issueRefreshToken(user.id) };
      } catch (err) {
        if (err instanceof InvalidCredentialsError) return reply.status(401).send({ message: err.message });
        throw err;
      }
    },
  );

  r.post(
    "/sessions/refresh",
    { config: { public: true }, schema: { body: refreshSessionSchema, security: [] } },
    async (req, reply) => {
      try {
        const rotated = await rotateRefreshToken(req.body.refreshToken);

        return { accessToken: signAccessToken(rotated.userId), refreshToken: rotated.refreshToken };
      } catch (err) {
        if (err instanceof InvalidRefreshTokenError) return reply.status(401).send({ message: err.message });
        throw err;
      }
    },
  );

  r.delete("/sessions", { preHandler: requireAuth(), schema: { body: refreshSessionSchema } }, async (req, reply) => {
    await revokeRefreshToken(req.body.refreshToken, req.auth.user.id);

    return reply.status(204).send();
  });

  r.get("/me", { preHandler: requireAuth() }, async (req) => ({
    ...req.auth.user,
    permissions: [...req.auth.permissions],
  }));
}
