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

describe("openapi: recipes", () => {
  test("GET /recipes documenta a lista sem itens", () => {
    const schema = responseSchemaOf(app, "get", "/recipes", 200) as { items: { properties: object } };
    expect(schema).toMatchObject({ type: "array", items: { properties: { margin: { type: "number" } } } });
    expect(schema.items.properties).not.toHaveProperty("items");
  });

  test("POST /recipes documenta os itens sem o insumo aninhado", () => {
    const schema = responseSchemaOf(app, "post", "/recipes", 201) as {
      properties: { items: { items: { properties: object } } };
    };
    expect(schema.properties.items.items.properties).toMatchObject({ usageQty: { type: "number" } });
    expect(schema.properties.items.items.properties).not.toHaveProperty("supply");
  });

  test("GET /recipes/{id} documenta o insumo aninhado em cada item", () => {
    expect(responseSchemaOf(app, "get", "/recipes/{id}", 200)).toMatchObject({
      properties: {
        items: {
          type: "array",
          items: { properties: { supply: { properties: { purchasePrice: { type: "number" } } } } },
        },
      },
    });
  });

  test("PATCH /recipes/{id}/margin documenta a receita sem itens", () => {
    expect(responseSchemaOf(app, "patch", "/recipes/{id}/margin", 200)).toMatchObject({
      properties: { margin: { type: "number" } },
    });
  });

  test("DELETE /recipes/{id} documenta o 204", () => {
    expect(responseSchemaOf(app, "delete", "/recipes/{id}", 204)).toBeDefined();
  });
});

describe("openapi: pricing", () => {
  test("GET /recipes/{id}/pricing documenta os cinco valores como number", () => {
    expect(responseSchemaOf(app, "get", "/recipes/{id}/pricing", 200)).toMatchObject({
      type: "object",
      properties: {
        suppliesCostPerHundred: { type: "number" },
        totalCostPerHundred: { type: "number" },
        exactPrice: { type: "number" },
        pricePerHundred: { type: "number" },
        pricePerHalfHundred: { type: "number" },
      },
    });
  });

  test("GET /recipes/{id}/pricing documenta 404 e 409", () => {
    expect(responseSchemaOf(app, "get", "/recipes/{id}/pricing", 404)).toBeDefined();
    expect(responseSchemaOf(app, "get", "/recipes/{id}/pricing", 409)).toBeDefined();
  });
});

describe("openapi: stock", () => {
  test("POST /supplies/{id}/stock-entries documenta movimento e saldo", () => {
    expect(responseSchemaOf(app, "post", "/supplies/{id}/stock-entries", 201)).toMatchObject({
      type: "object",
      properties: {
        movement: { properties: { quantityBase: { type: "number" }, createdAt: { format: "date-time" } } },
        currentStock: { type: "number" },
      },
    });
  });

  test("POST /supplies/{id}/stock-entries documenta 400 e 404", () => {
    expect(responseSchemaOf(app, "post", "/supplies/{id}/stock-entries", 400)).toBeDefined();
    expect(responseSchemaOf(app, "post", "/supplies/{id}/stock-entries", 404)).toBeDefined();
  });

  test("GET /supplies/{id}/movements documenta a lista do razão", () => {
    expect(responseSchemaOf(app, "get", "/supplies/{id}/movements", 200)).toMatchObject({
      type: "array",
      items: { properties: { type: { type: "string" }, quantityBase: { type: "number" } } },
    });
  });
});
