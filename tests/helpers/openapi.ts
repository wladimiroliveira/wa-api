import type { FastifyInstance } from "fastify";

type OpenApiResponse = { content?: Record<string, { schema?: unknown }> };
type OpenApiOperation = { responses?: Record<string, OpenApiResponse> };
type OpenApiDocument = { paths?: Record<string, Record<string, OpenApiOperation>> };

function documentOf(app: FastifyInstance): OpenApiDocument {
  return app.swagger() as unknown as OpenApiDocument;
}

/** JSON Schema declarado para um status, ou undefined quando a rota não declara. */
export function responseSchemaOf(app: FastifyInstance, method: string, path: string, status: number): unknown {
  const operation = documentOf(app).paths?.[path]?.[method.toLowerCase()];
  return operation?.responses?.[String(status)]?.content?.["application/json"]?.schema;
}

/** Toda operação do documento, achatada, para o guarda-corpo global. */
export function operationsOf(app: FastifyInstance) {
  const paths = documentOf(app).paths ?? {};

  return Object.entries(paths).flatMap(([path, item]) =>
    Object.entries(item).map(([method, operation]) => ({
      method,
      path,
      responses: operation.responses ?? {},
    })),
  );
}
