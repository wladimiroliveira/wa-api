import { fileURLToPath } from "node:url";
import fastify from "fastify";
import "dotenv/config";
import type { FastifyError, FastifyReply, FastifyRequest, FastifyInstance } from "fastify";
import routes from "./routes.js";
import { fastifySwagger } from "@fastify/swagger";
import { fastifySwaggerUi } from "@fastify/swagger-ui";
import { fastifyCors } from "@fastify/cors";
import { serializerCompiler, validatorCompiler, jsonSchemaTransform, ZodTypeProvider } from "fastify-type-provider-zod";
import { Prisma } from "./generated/prisma/index.js";

function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") return reply.status(404).send({ message: "Recurso não encontrado" });
    if (error.code === "P2003") return reply.status(409).send({ message: "Operação viola uma referência existente" });
  }

  // validação do zod / erros já com status: preserva
  if (error.validation || (error.statusCode && error.statusCode < 500)) {
    return reply.send(error);
  }

  request.log.error(error);
  return reply.status(500).send({ message: "Erro interno" });
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = fastify().withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifyCors, {
    origin: ["*"],
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "wa-api",
        description: "Backend para o wa-system",
        version: "0.0.0",
      },

      components: {
        securitySchemes: {
          BearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
      servers: [{ url: `http://localhost:${process.env.API_PORT || 3333}`, description: "Servidor local" }],
    },
    transform: jsonSchemaTransform,
  });

  await app.after(app.withTypeProvider);

  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
  });

  app.setErrorHandler(errorHandler);
  app.register(routes);

  return app;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const app = await buildApp();
  await app.listen({ port: Number(process.env.API_PORT) || 3333, host: "0.0.0.0" });
  console.log("Server is running");
}
