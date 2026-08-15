import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/server.js";
import { responseSchemaOf } from "../helpers/openapi.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("openapi: supplies", () => {
  test("GET /supplies documenta a lista", () => {
    expect(responseSchemaOf(app, "get", "/supplies", 200)).toMatchObject({
      type: "array",
      items: { type: "object", properties: { purchasePrice: { type: "number" } } },
    });
  });

  test("GET /supplies/{id} documenta decimal como number e timestamp como date-time", () => {
    expect(responseSchemaOf(app, "get", "/supplies/{id}", 200)).toMatchObject({
      type: "object",
      properties: {
        purchaseQty: { type: "number" },
        purchasePrice: { type: "number" },
        currentStock: { type: "number" },
        createdAt: { type: "string", format: "date-time" },
      },
    });
  });

  test("GET /supplies/{id} documenta 404 e os erros de rota protegida", () => {
    for (const status of [401, 403, 404]) {
      expect(responseSchemaOf(app, "get", "/supplies/{id}", status)).toMatchObject({
        properties: { message: { type: "string" } },
      });
    }
  });

  test("DELETE /supplies/{id} documenta o 204", () => {
    expect(responseSchemaOf(app, "delete", "/supplies/{id}", 204)).toBeDefined();
  });
});
