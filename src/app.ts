import fastify, { FastifyInstance } from "fastify";
import routes from "./routes.js";
import { fastifySwagger } from "@fastify/swagger";
import { fastifySwaggerUi } from "@fastify/swagger-ui";
import { fastifyCors } from "@fastify/cors";
import { serializerCompiler, validatorCompiler, jsonSchemaTransform, ZodTypeProvider } from "fastify-type-provider-zod";
import { loadEnv } from "./lib/env.js";

export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = fastify().withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifyCors, {
    origin: ["*"],
    methods: ["GET", "POST", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

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
  await app.register(fastifySwaggerUi, { routePrefix: "/docs" });
  await app.register(routes);
  await app.ready();

  return app;
}
