import fastify, { FastifyInstance } from "fastify";
import routes from "./routes.js";
import { fastifySwagger } from "@fastify/swagger";
import { fastifySwaggerUi } from "@fastify/swagger-ui";
import { fastifyCors } from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import { serializerCompiler, validatorCompiler, jsonSchemaTransform, ZodTypeProvider } from "fastify-type-provider-zod";
import { API_PREFIX } from "./lib/api-version.js";
import { loadEnv } from "./lib/env.js";
import { registerAccessToken } from "./modules/auth/auth.jwt.js";

export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = fastify().withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifyCors, {
    origin: env.CORS_ORIGINS,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  // Not global: the limit applies only where a route asks for it.
  await app.register(fastifyRateLimit, { global: false });

  await app.register(fastifySwagger, {
    openapi: {
      info: { title: "wa-api", description: "Backend para o wa-system", version: "0.0.0" },
      components: {
        securitySchemes: { BearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      },
      servers: [{ url: `http://localhost:${env.API_PORT}`, description: "Servidor local" }],
    },
    transform: jsonSchemaTransform,
  });

  await app.after(app.withTypeProvider);
  await app.register(fastifySwaggerUi, { routePrefix: `${API_PREFIX}/docs` });

  await registerAccessToken(app, { secret: env.JWT_SECRET, ttlMinutes: env.ACCESS_TOKEN_TTL_MINUTES });

  await app.register(routes, { prefix: API_PREFIX });
  await app.ready();

  return app;
}
