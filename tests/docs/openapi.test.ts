import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/server.js";
import { operationsOf, responseSchemaOf } from "../helpers/openapi.js";

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

  test("DELETE /supplies/{id} documenta o 409 de insumo em uso", () => {
    expect(responseSchemaOf(app, "delete", "/supplies/{id}", 409)).toBeDefined();
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

  test("DELETE /recipes/{id} documenta o 409 de receita em uso", () => {
    expect(responseSchemaOf(app, "delete", "/recipes/{id}", 409)).toBeDefined();
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

describe("openapi: waste", () => {
  test("POST /supplies/{id}/wastes documenta o mesmo envelope do estoque", () => {
    expect(responseSchemaOf(app, "post", "/supplies/{id}/wastes", 201)).toMatchObject({
      properties: { movement: { properties: { reason: {} } }, currentStock: { type: "number" } },
    });
  });

  test("GET /wastes documenta o insumo aninhado em cada registro", () => {
    expect(responseSchemaOf(app, "get", "/wastes", 200)).toMatchObject({
      type: "array",
      items: { properties: { supply: { properties: { name: { type: "string" } } } } },
    });
  });
});

describe("openapi: production", () => {
  test("POST /productions documenta produção, consumos e avisos", () => {
    expect(responseSchemaOf(app, "post", "/productions", 201)).toMatchObject({
      type: "object",
      properties: {
        production: { properties: { factor: { type: "number" }, producedUnits: { type: "number" } } },
        consumptions: { type: "array", items: { properties: { consumedBase: { type: "number" } } } },
        warnings: { type: "array", items: { properties: { resultingStock: { type: "number" } } } },
      },
    });
  });

  test("POST /productions documenta o 404 de receita inexistente", () => {
    expect(responseSchemaOf(app, "post", "/productions", 404)).toBeDefined();
  });

  test("GET /productions/{id} documenta os movimentos gerados", () => {
    expect(responseSchemaOf(app, "get", "/productions/{id}", 200)).toMatchObject({
      properties: { movements: { type: "array", items: { properties: { quantityBase: { type: "number" } } } } },
    });
  });
});

describe("openapi: health", () => {
  test("GET /health documenta 200 e 503 com os mesmos campos", () => {
    for (const status of [200, 503]) {
      expect(responseSchemaOf(app, "get", "/health", status)).toMatchObject({
        type: "object",
        properties: { status: { enum: ["ok", "error"] }, database: { enum: ["up", "down"] } },
      });
    }
  });
});

describe("openapi: roles", () => {
  test("GET /roles documenta a lista com o pacote de permissões", () => {
    expect(responseSchemaOf(app, "get", "/roles", 200)).toMatchObject({
      type: "array",
      items: { properties: { name: { type: "string" }, permissions: { type: "array" } } },
    });
  });

  test("POST /roles documenta 201 e o 409 de nome duplicado", () => {
    expect(responseSchemaOf(app, "post", "/roles", 201)).toBeDefined();
    expect(responseSchemaOf(app, "post", "/roles", 409)).toBeDefined();
  });

  test("DELETE /roles/{id} documenta o 204", () => {
    expect(responseSchemaOf(app, "delete", "/roles/{id}", 204)).toBeDefined();
  });
});

describe("openapi: users", () => {
  test("GET /users documenta a lista sem passwordHash", () => {
    const schema = responseSchemaOf(app, "get", "/users", 200) as { items: { properties: object } };
    expect(schema.items.properties).toMatchObject({ username: { type: "string" }, isActive: { type: "boolean" } });
    expect(schema.items.properties).not.toHaveProperty("passwordHash");
  });

  test("GET /users/{id}/permissions documenta as permissões já computadas", () => {
    expect(responseSchemaOf(app, "get", "/users/{id}/permissions", 200)).toMatchObject({
      type: "object",
      properties: { userId: { type: "string" }, permissions: { type: "array" } },
    });
  });

  test("POST /users documenta o 409 de username duplicado", () => {
    expect(responseSchemaOf(app, "post", "/users", 409)).toBeDefined();
  });
});

describe("openapi: auth", () => {
  test("POST /sessions documenta o par de tokens", () => {
    expect(responseSchemaOf(app, "post", "/sessions", 200)).toMatchObject({
      type: "object",
      properties: { accessToken: { type: "string" }, refreshToken: { type: "string" } },
    });
  });

  test("POST /sessions documenta 401 e o 429 do rate limit", () => {
    expect(responseSchemaOf(app, "post", "/sessions", 401)).toBeDefined();
    expect(responseSchemaOf(app, "post", "/sessions", 429)).toBeDefined();
  });

  test("GET /me documenta o usuário e as permissões efetivas", () => {
    expect(responseSchemaOf(app, "get", "/me", 200)).toMatchObject({
      type: "object",
      properties: {
        id: { type: "string" },
        username: { type: "string" },
        permissions: { type: "array" },
      },
    });
  });

  test("GET /me não documenta passwordHash", () => {
    const schema = responseSchemaOf(app, "get", "/me", 200) as { properties: object };
    expect(schema.properties).not.toHaveProperty("passwordHash");
  });

  test("DELETE /sessions documenta o 204", () => {
    expect(responseSchemaOf(app, "delete", "/sessions", 204)).toBeDefined();
  });
});

describe("openapi: guarda-corpo", () => {
  const SUCCESS_STATUSES = ["200", "201", "204"];

  test("toda rota declara schema de resposta para o seu status de sucesso", () => {
    const missing = operationsOf(app)
      .filter((op) => !SUCCESS_STATUSES.some((s) => op.responses[s]?.content?.["application/json"]?.schema))
      .map((op) => `${op.method.toUpperCase()} ${op.path}`);

    expect(missing).toEqual([]);
  });

  test("o documento cobre as 33 rotas da API", () => {
    expect(operationsOf(app)).toHaveLength(33);
  });
});
