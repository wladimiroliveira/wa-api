# Camada de Schemas de Resposta — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Declarar `response` nas 33 rotas da API para que o OpenAPI documente cada corpo devolvido e o serializer do Zod passe a governar o que sai.

**Architecture:** Um módulo compartilhado (`src/modules/shared/response.ts`) define os tipos que se repetem — decimal, timestamp, erro, erros de rota protegida. Cada `<module>.schema.ts` ganha os schemas de saída do seu módulo, ao lado dos de entrada. Cada rota passa `response: { <status>: <schema> }`. Um teste de OpenAPI cresce módulo a módulo e termina como guarda-corpo global.

**Tech Stack:** Fastify 5, `fastify-type-provider-zod` 6, `@fastify/swagger` 9, Zod 4, Prisma 6, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-15-schemas-de-resposta-design.md`

## Global Constraints

- **Branch:** criar `feat/response-schemas` a partir de `feat/username-login` antes da Task 1. Nunca trabalhar na `main`.
- **Commits:** o CLAUDE.md do projeto proíbe commitar sem ordem explícita do usuário. Os passos de commit deste plano marcam o ponto de corte de cada task; execute-os apenas se o usuário tiver autorizado commits por task. Caso contrário, deixe o trabalho na árvore e siga para a próxima task.
- **Idioma:** todo identificador, nome de arquivo, teste e comentário em inglês. Comentários explicativos podem ser em português, seguindo o que o código já faz hoje.
- **TDD:** teste vermelho antes da implementação, com a saída colada, em toda task.
- **Verificação:** `npx vitest run <arquivo>` para o alvo da task. O portão completo (`npm test`) só na Task 12.
- **Banco:** os testes de OpenAPI não precisam de banco (`buildApp()` + `app.ready()` não conecta). Os testes de rota existentes precisam do PostgreSQL do `docker-compose.yml` de pé.
- **Conversão de decimal:** `Prisma.Decimal` → `number` via `z.coerce.number()`. Nenhum `transform` manual, nenhuma mudança na aritmética interna.

---

### Task 1: Fundação compartilhada e helper de teste do OpenAPI

**Files:**

- Create: `src/modules/shared/response.ts`
- Create: `tests/helpers/openapi.ts`
- Test: `tests/modules/shared/response.test.ts`

**Interfaces:**

- Consumes: nada.
- Produces:
  - `decimalSchema: z.ZodCoercedNumber` — aceita `Prisma.Decimal`, `string` ou `number`, devolve `number`
  - `timestampSchema: z.ZodCoercedDate` — aceita `Date` ou `string`, devolve `Date` (serializado como ISO 8601)
  - `errorSchema: z.ZodObject` — `{ message: string; code?: string; statusCode?: number; error?: string }`
  - `noContentSchema: z.ZodNull`
  - `protectedErrors: { 401: typeof errorSchema; 403: typeof errorSchema }`
  - `responseSchemaOf(app, method, path, status): unknown | undefined`
  - `operationsOf(app): { method: string; path: string; responses: Record<string, OpenApiResponse> }[]`

- [ ] **Step 1: Write the failing test**

`tests/modules/shared/response.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { Prisma } from "../../../src/generated/prisma/index.js";
import { decimalSchema, errorSchema, timestampSchema } from "../../../src/modules/shared/response.js";

describe("response schemas compartilhados", () => {
  test("decimalSchema converte Prisma.Decimal em number", () => {
    expect(decimalSchema.parse(new Prisma.Decimal("15.50"))).toBe(15.5);
  });

  test("decimalSchema aceita a string que o pricing já formata", () => {
    expect(decimalSchema.parse("65.00")).toBe(65);
  });

  test("timestampSchema aceita Date e serializa como ISO 8601", () => {
    const parsed = timestampSchema.parse(new Date("2026-08-15T12:00:00.000Z"));
    expect(JSON.stringify(parsed)).toBe('"2026-08-15T12:00:00.000Z"');
  });

  test("errorSchema aceita o erro de domínio com code", () => {
    expect(errorSchema.parse({ code: "DIMENSION_MISMATCH", message: "dimensões diferentes" })).toEqual({
      code: "DIMENSION_MISMATCH",
      message: "dimensões diferentes",
    });
  });

  test("errorSchema aceita o erro de validação que o Fastify gera", () => {
    const fastifyError = {
      statusCode: 400,
      code: "FST_ERR_VALIDATION",
      error: "Bad Request",
      message: "body inválido",
    };
    expect(errorSchema.parse(fastifyError)).toEqual(fastifyError);
  });

  test("errorSchema exige message", () => {
    expect(errorSchema.safeParse({ code: "X" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/shared/response.test.ts`
Expected: FAIL — `Failed to resolve import ".../src/modules/shared/response.js"`

- [ ] **Step 3: Write minimal implementation**

`src/modules/shared/response.ts`:

```ts
import { z } from "zod";

/** Prisma.Decimal chega como objeto; valueOf() devolve o número, então coerce resolve sem transform. */
export const decimalSchema = z.coerce.number();

/** Date do Prisma vira ISO 8601 no corpo e `string / date-time` no OpenAPI. */
export const timestampSchema = z.coerce.date();

/**
 * Cobre os três formatos de erro que a API produz hoje: `{ message }` das rotas,
 * `{ code, message }` dos erros de domínio e o `{ statusCode, code, error, message }`
 * que o Fastify monta a partir da validação do Zod. Em POST /recipes os dois
 * últimos dividem o status 400, então um schema estrito quebraria a serialização.
 */
export const errorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  statusCode: z.number().optional(),
  error: z.string().optional(),
});

/** 204 não tem corpo; a declaração existe para o OpenAPI descrever o status. */
export const noContentSchema = z.null();

/** Espalhado nas rotas que exigem permissão. */
export const protectedErrors = { 401: errorSchema, 403: errorSchema } as const;
```

`tests/helpers/openapi.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/shared/response.test.ts`
Expected: PASS — 6 testes

- [ ] **Step 5: Commit**

```bash
git add src/modules/shared/response.ts tests/helpers/openapi.ts tests/modules/shared/response.test.ts
git commit -m "feat(shared): add response schemas for decimals, timestamps and errors"
```

---

### Task 2: Supplies

Esta task também resolve, para todas as demais, a dúvida do 204: se `noContentSchema` não aparecer no documento, troque `z.null()` por `z.void()` em `src/modules/shared/response.ts` e siga.

**Files:**

- Modify: `src/modules/supplies/supplies.schema.ts`
- Modify: `src/modules/supplies/supplies.routes.ts`
- Modify: `tests/modules/supplies/supplies.routes.test.ts:47-49,99`
- Test: `tests/docs/openapi.test.ts` (criar)

**Interfaces:**

- Consumes: `decimalSchema`, `timestampSchema`, `errorSchema`, `noContentSchema`, `protectedErrors` da Task 1; `responseSchemaOf` de `tests/helpers/openapi.ts`.
- Produces: `supplyResponseSchema`, `supplyListResponseSchema` de `src/modules/supplies/supplies.schema.ts` — recipes, stock e waste importam o primeiro.

- [ ] **Step 1: Write the failing test**

`tests/docs/openapi.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/docs/openapi.test.ts`
Expected: FAIL — os quatro testes recebem `undefined`, porque hoje o documento só traz `200: { description: "Default Response" }` sem `content`.

- [ ] **Step 3: Write minimal implementation**

Acrescentar ao fim de `src/modules/supplies/supplies.schema.ts` (e importar o compartilhado no topo):

```ts
import { decimalSchema, timestampSchema } from "../shared/response.js";

export const supplyResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: supplyTypeSchema,
  purchaseUnit: unitOfMeasureSchema,
  purchaseQty: decimalSchema,
  purchasePrice: decimalSchema,
  currentStock: decimalSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const supplyListResponseSchema = z.array(supplyResponseSchema);
```

Em `src/modules/supplies/supplies.routes.ts`, importar

```ts
import { errorSchema, noContentSchema, protectedErrors } from "../shared/response.js";
import { supplyListResponseSchema, supplyResponseSchema } from "./supplies.schema.js";
```

e declarar `response` em cada rota:

```ts
r.get(
  "/supplies",
  {
    preHandler: requirePermission(Permission.SUPPLIES_READ),
    schema: { response: { 200: supplyListResponseSchema, ...protectedErrors } },
  },
  async () => repo.listSupplies(),
);

r.post(
  "/supplies",
  {
    preHandler: requirePermission(Permission.SUPPLIES_WRITE),
    schema: {
      body: createSupplySchema,
      response: { 201: supplyResponseSchema, 400: errorSchema, ...protectedErrors },
    },
  },
  async (req, reply) => {
    const supply = await repo.createSupply(req.body);
    return reply.status(201).send(supply);
  },
);

r.get(
  "/supplies/:id",
  {
    preHandler: requirePermission(Permission.SUPPLIES_READ),
    schema: {
      params: supplyIdParamSchema,
      response: { 200: supplyResponseSchema, 404: errorSchema, ...protectedErrors },
    },
  },
  async (req, reply) => {
    const supply = await repo.getSupply(req.params.id);
    if (!supply) return reply.status(404).send({ message: "Insumo não encontrado" });
    return supply;
  },
);

r.patch(
  "/supplies/:id",
  {
    preHandler: requirePermission(Permission.SUPPLIES_WRITE),
    schema: {
      params: supplyIdParamSchema,
      body: updateSupplySchema,
      response: { 200: supplyResponseSchema, 400: errorSchema, 404: errorSchema, ...protectedErrors },
    },
  },
  async (req) => repo.updateSupply(req.params.id, req.body),
);

r.delete(
  "/supplies/:id",
  {
    preHandler: requirePermission(Permission.SUPPLIES_WRITE),
    schema: {
      params: supplyIdParamSchema,
      response: { 204: noContentSchema, 404: errorSchema, ...protectedErrors },
    },
  },
  async (req, reply) => {
    await repo.deleteSupply(req.params.id);
    return reply.status(204).send();
  },
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/docs/openapi.test.ts`
Expected: PASS — 4 testes

- [ ] **Step 5: Atualizar o teste de integração para decimal em number**

Em `tests/modules/supplies/supplies.routes.test.ts`, linhas 47-49:

```ts
      purchaseQty: 2,
      purchasePrice: 15.5,
      currentStock: 0,
```

e linha 99:

```ts
expect(res.json()).toMatchObject({ name: "Leite (crud)", purchaseQty: 2, purchasePrice: 9.9 });
```

Run: `npx vitest run tests/modules/supplies/supplies.routes.test.ts`
Expected: PASS — o banco precisa estar de pé (`docker compose up -d`)

- [ ] **Step 6: Commit**

```bash
git add src/modules/supplies tests/docs/openapi.test.ts tests/modules/supplies
git commit -m "feat(supplies): document and enforce response schemas"
```

---

### Task 3: Recipes

**Files:**

- Modify: `src/modules/recipes/recipes.schema.ts`
- Modify: `src/modules/recipes/recipes.routes.ts`
- Modify: `tests/modules/recipes/recipes.routes.test.ts:89,112`
- Test: `tests/docs/openapi.test.ts`

**Interfaces:**

- Consumes: `supplyResponseSchema` da Task 2; compartilhados da Task 1.
- Produces: `recipeResponseSchema`, `recipeListResponseSchema`, `recipeItemResponseSchema`, `recipeWithItemsResponseSchema`, `recipeDetailResponseSchema` — pricing importa `recipeDetailResponseSchema` só indiretamente; production não importa nada daqui.

São três formas distintas: `GET /recipes` devolve a receita sem itens; `POST /recipes` e `PATCH /recipes/:id` devolvem com `items` (o repositório usa `include: { items: true }`); `GET /recipes/:id` usa `getRecipeWithItems`, que aninha `supply` dentro de cada item.

- [ ] **Step 1: Write the failing test**

Acrescentar a `tests/docs/openapi.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/docs/openapi.test.ts -t "openapi: recipes"`
Expected: FAIL — `responseSchemaOf` devolve `undefined` nas cinco asserções

- [ ] **Step 3: Write minimal implementation**

Acrescentar a `src/modules/recipes/recipes.schema.ts`. A linha 2 já importa `unitOfMeasureSchema` de `../supplies/supplies.schema.js` — estenda esse import em vez de criar um segundo:

```ts
// linha 2, estendida:
import { supplyResponseSchema, unitOfMeasureSchema } from "../supplies/supplies.schema.js";
// import novo:
import { decimalSchema, timestampSchema } from "../shared/response.js";

export const recipeResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  batchYield: decimalSchema,
  laborCostPerHundred: decimalSchema,
  margin: decimalSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const recipeListResponseSchema = z.array(recipeResponseSchema);

export const recipeItemResponseSchema = z.object({
  id: z.string().uuid(),
  recipeId: z.string().uuid(),
  supplyId: z.string().uuid(),
  usageQty: decimalSchema,
  usageUnit: unitOfMeasureSchema,
});

/** POST e PATCH devolvem `include: { items: true }` — item sem o insumo. */
export const recipeWithItemsResponseSchema = recipeResponseSchema.extend({
  items: z.array(recipeItemResponseSchema),
});

/** GET /recipes/:id usa getRecipeWithItems, que aninha o insumo em cada item. */
export const recipeDetailResponseSchema = recipeResponseSchema.extend({
  items: z.array(recipeItemResponseSchema.extend({ supply: supplyResponseSchema })),
});
```

Em `src/modules/recipes/recipes.routes.ts`, importar os schemas e `errorSchema`, `noContentSchema`, `protectedErrors`, e declarar:

```ts
// GET /recipes
schema: { response: { 200: recipeListResponseSchema, ...protectedErrors } },

// POST /recipes
schema: {
  body: createRecipeSchema,
  response: { 201: recipeWithItemsResponseSchema, 400: errorSchema, ...protectedErrors },
},

// GET /recipes/:id
schema: {
  params: recipeIdParamSchema,
  response: { 200: recipeDetailResponseSchema, 404: errorSchema, ...protectedErrors },
},

// PATCH /recipes/:id/margin
schema: {
  params: recipeIdParamSchema,
  body: updateMarginSchema,
  response: { 200: recipeResponseSchema, 400: errorSchema, 404: errorSchema, ...protectedErrors },
},

// PATCH /recipes/:id
schema: {
  params: recipeIdParamSchema,
  body: updateRecipeSchema,
  response: { 200: recipeWithItemsResponseSchema, 400: errorSchema, 404: errorSchema, ...protectedErrors },
},

// DELETE /recipes/:id
schema: {
  params: recipeIdParamSchema,
  response: { 204: noContentSchema, 404: errorSchema, ...protectedErrors },
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/docs/openapi.test.ts`
Expected: PASS — 9 testes

- [ ] **Step 5: Atualizar o teste de integração**

Em `tests/modules/recipes/recipes.routes.test.ts`, linha 89:

```ts
expect(body.laborCostPerHundred).toBe(25);
```

linha 112:

```ts
expect(usageQtys).toEqual([0.5, 2]);
```

Run: `npx vitest run tests/modules/recipes/recipes.routes.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/recipes tests/docs/openapi.test.ts tests/modules/recipes
git commit -m "feat(recipes): document and enforce response schemas"
```

---

### Task 4: Pricing

O handler já devolve strings formatadas (`toFixed(2)`, `toString()`). `decimalSchema` converte string em number, então **o handler não muda** — só ganha o schema. `"65.00"` vira `65`.

**Files:**

- Create: `src/modules/pricing/pricing.schema.ts`
- Modify: `src/modules/pricing/pricing.routes.ts`
- Modify: `tests/modules/pricing/pricing.routes.test.ts:63-65`
- Test: `tests/docs/openapi.test.ts`

**Interfaces:**

- Consumes: `decimalSchema`, `errorSchema`, `protectedErrors` da Task 1.
- Produces: `pricingResponseSchema` de `src/modules/pricing/pricing.schema.ts`.

- [ ] **Step 1: Write the failing test**

Acrescentar a `tests/docs/openapi.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/docs/openapi.test.ts -t "openapi: pricing"`
Expected: FAIL — `undefined` nas duas asserções

- [ ] **Step 3: Write minimal implementation**

`src/modules/pricing/pricing.schema.ts`:

```ts
import { z } from "zod";
import { decimalSchema } from "../shared/response.js";

/**
 * O handler já formata: custos e preços com duas casas, `exactPrice` sem
 * arredondamento. `decimalSchema` converte essas strings em number, então
 * "65.00" chega ao cliente como 65 — formatar é trabalho do front.
 */
export const pricingResponseSchema = z.object({
  suppliesCostPerHundred: decimalSchema,
  totalCostPerHundred: decimalSchema,
  exactPrice: decimalSchema,
  pricePerHundred: decimalSchema,
  pricePerHalfHundred: decimalSchema,
});
```

Em `src/modules/pricing/pricing.routes.ts`:

```ts
import { errorSchema, protectedErrors } from "../shared/response.js";
import { pricingResponseSchema } from "./pricing.schema.js";

// no schema da rota:
schema: {
  params: recipeIdParamSchema,
  response: { 200: pricingResponseSchema, 404: errorSchema, 409: errorSchema, ...protectedErrors },
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/docs/openapi.test.ts`
Expected: PASS — 11 testes

- [ ] **Step 5: Atualizar o teste de integração**

Em `tests/modules/pricing/pricing.routes.test.ts`, linhas 63-65:

```ts
expect(body.totalCostPerHundred).toBe(65);
expect(body.pricePerHundred).toBe(104);
expect(body.pricePerHalfHundred).toBe(52);
```

Run: `npx vitest run tests/modules/pricing/pricing.routes.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/pricing tests/docs/openapi.test.ts tests/modules/pricing
git commit -m "feat(pricing): document and enforce response schemas"
```

---

### Task 5: Stock

`createStockEntry` devolve `currentStock: updated?.currentStock` — opcional no tipo, mas o insumo acabou de ser validado como existente na primeira linha do serviço. Com o schema estrito o `undefined` viraria erro de serialização, então o serviço passa a afirmar a presença.

**Files:**

- Modify: `src/modules/stock/stock.schema.ts`
- Modify: `src/modules/stock/stock.routes.ts`
- Modify: `src/modules/stock/stock.service.ts:38-39`
- Modify: `tests/modules/stock/stock.routes.test.ts:46,49,58`
- Test: `tests/docs/openapi.test.ts`

**Interfaces:**

- Consumes: compartilhados da Task 1.
- Produces: `stockMovementTypeSchema`, `wasteReasonSchema`, `stockMovementResponseSchema`, `stockMovementListResponseSchema`, `stockEntryResponseSchema` — waste e production importam daqui.

**`wasteReasonSchema` muda de casa.** Hoje ele mora em `waste.schema.ts`. Se `stock.schema.ts` importasse de lá, a Task 6 — que faz `waste.schema.ts` importar `stockMovementResponseSchema` — fecharia um ciclo de imports, e schemas do Zod inicializados em ciclo estouram por TDZ na carga do módulo. O campo `reason` pertence ao model `StockMovement`, então o schema passa a morar em `stock.schema.ts` e `waste.schema.ts` importa dele. Nenhum outro arquivo usa esse export hoje.

- [ ] **Step 1: Write the failing test**

Acrescentar a `tests/docs/openapi.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/docs/openapi.test.ts -t "openapi: stock"`
Expected: FAIL — `undefined` nas três asserções

- [ ] **Step 3: Write minimal implementation**

Acrescentar a `src/modules/stock/stock.schema.ts`:

```ts
import { StockMovementType, WasteReason } from "../../generated/prisma/index.js";
import { decimalSchema, timestampSchema } from "../shared/response.js";

export const stockMovementTypeSchema = z.enum(StockMovementType);

/** Mora aqui porque `reason` é campo de StockMovement; waste importa deste arquivo. */
export const wasteReasonSchema = z.enum(WasteReason);

export const stockMovementResponseSchema = z.object({
  id: z.string().uuid(),
  supplyId: z.string().uuid(),
  type: stockMovementTypeSchema,
  quantityBase: decimalSchema,
  reason: wasteReasonSchema.nullable(),
  note: z.string().nullable(),
  productionId: z.string().uuid().nullable(),
  createdAt: timestampSchema,
});

export const stockMovementListResponseSchema = z.array(stockMovementResponseSchema);

/** Envelope de criação compartilhado com waste: o movimento mais o saldo resultante. */
export const stockEntryResponseSchema = z.object({
  movement: stockMovementResponseSchema,
  currentStock: decimalSchema,
});
```

Em `src/modules/stock/stock.service.ts`, o fim de `createStockEntry`:

```ts
// O insumo foi validado no início; o saldo sempre existe aqui.
const updated = await getSupply(supplyId);
return { movement, currentStock: updated!.currentStock };
```

Em `src/modules/stock/stock.routes.ts`:

```ts
// POST /supplies/:id/stock-entries
schema: {
  params: supplyIdParamSchema,
  body: createStockEntrySchema,
  response: { 201: stockEntryResponseSchema, 400: errorSchema, 404: errorSchema, ...protectedErrors },
},

// GET /supplies/:id/movements
schema: {
  params: supplyIdParamSchema,
  response: { 200: stockMovementListResponseSchema, 404: errorSchema, ...protectedErrors },
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/docs/openapi.test.ts`
Expected: PASS — 14 testes

- [ ] **Step 5: Atualizar o teste de integração**

Em `tests/modules/stock/stock.routes.test.ts`, linhas 46, 49 e 58:

```ts
expect(entry.json().currentStock).toBe(2000);
expect(supply.json().currentStock).toBe(2000);
expect(movements.json()[0].quantityBase).toBe(2000);
```

Run: `npx vitest run tests/modules/stock/stock.routes.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/stock tests/docs/openapi.test.ts tests/modules/stock
git commit -m "feat(stock): document and enforce response schemas"
```

---

### Task 6: Waste

**Files:**

- Modify: `src/modules/waste/waste.schema.ts`
- Modify: `src/modules/waste/waste.routes.ts`
- Modify: `src/modules/waste/waste.service.ts:29-30`
- Modify: `tests/modules/waste/waste.routes.test.ts:46`
- Test: `tests/docs/openapi.test.ts`

**Interfaces:**

- Consumes: `stockMovementResponseSchema` e `stockEntryResponseSchema` da Task 5; `supplyResponseSchema` da Task 2.
- Produces: `wasteResponseSchema`, `wasteListResponseSchema`.

- [ ] **Step 1: Write the failing test**

Acrescentar a `tests/docs/openapi.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/docs/openapi.test.ts -t "openapi: waste"`
Expected: FAIL — `undefined` nas duas asserções

- [ ] **Step 3: Write minimal implementation**

Em `src/modules/waste/waste.schema.ts`, remover a definição local de `wasteReasonSchema` (linha 4) e passar a importá-la do stock, junto do resto:

```ts
import { stockMovementResponseSchema, wasteReasonSchema } from "../stock/stock.schema.js";
import { supplyResponseSchema } from "../supplies/supplies.schema.js";

// `createWasteSchema` continua usando `wasteReasonSchema` exatamente como antes.
// Reexportar mantém compatível qualquer import futuro que espere achá-lo aqui:
export { wasteReasonSchema };

/** GET /wastes lista movimentos com o insumo aninhado. */
export const wasteResponseSchema = stockMovementResponseSchema.extend({ supply: supplyResponseSchema });

export const wasteListResponseSchema = z.array(wasteResponseSchema);
```

Em `src/modules/waste/waste.service.ts`, o fim de `createWaste`:

```ts
// O insumo foi validado no início; o saldo sempre existe aqui.
const updated = await getSupply(supplyId);
return { movement, currentStock: updated!.currentStock };
```

Em `src/modules/waste/waste.routes.ts`:

```ts
import { errorSchema, protectedErrors } from "../shared/response.js";
import { stockEntryResponseSchema } from "../stock/stock.schema.js";
import { wasteListResponseSchema } from "./waste.schema.js";

// POST /supplies/:id/wastes
schema: {
  params: supplyIdParamSchema,
  body: createWasteSchema,
  response: { 201: stockEntryResponseSchema, 400: errorSchema, 404: errorSchema, ...protectedErrors },
},

// GET /wastes
schema: { response: { 200: wasteListResponseSchema, ...protectedErrors } },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/docs/openapi.test.ts`
Expected: PASS — 16 testes

- [ ] **Step 5: Atualizar o teste de integração**

Em `tests/modules/waste/waste.routes.test.ts`, linha 46:

```ts
expect(res.json().currentStock).toBe(800); // 1000 - 200
```

Run: `npx vitest run tests/modules/waste/waste.routes.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/waste tests/docs/openapi.test.ts tests/modules/waste
git commit -m "feat(waste): document and enforce response schemas"
```

---

### Task 7: Production

**Files:**

- Modify: `src/modules/production/production.schema.ts`
- Modify: `src/modules/production/production.routes.ts`
- Modify: `tests/modules/production/production.routes.test.ts:75,76,80,126`
- Test: `tests/docs/openapi.test.ts`

**Interfaces:**

- Consumes: `stockMovementResponseSchema` da Task 5; compartilhados da Task 1.
- Produces: `productionResponseSchema`, `productionListResponseSchema`, `productionDetailResponseSchema`, `registerProductionResponseSchema`.

`POST /productions` responde 404 quando a receita não existe, apesar de não ter `:id` na rota.

- [ ] **Step 1: Write the failing test**

Acrescentar a `tests/docs/openapi.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/docs/openapi.test.ts -t "openapi: production"`
Expected: FAIL — `undefined` nas três asserções

- [ ] **Step 3: Write minimal implementation**

Acrescentar a `src/modules/production/production.schema.ts`:

```ts
import { decimalSchema, timestampSchema } from "../shared/response.js";
import { stockMovementResponseSchema } from "../stock/stock.schema.js";

export const productionResponseSchema = z.object({
  id: z.string().uuid(),
  recipeId: z.string().uuid(),
  factor: decimalSchema,
  producedUnits: decimalSchema,
  note: z.string().nullable(),
  createdAt: timestampSchema,
});

export const productionListResponseSchema = z.array(productionResponseSchema);

export const productionDetailResponseSchema = productionResponseSchema.extend({
  movements: z.array(stockMovementResponseSchema),
});

/** Warnings: insumos cujo saldo ficou negativo — a regra avisa, não bloqueia. */
export const registerProductionResponseSchema = z.object({
  production: productionResponseSchema,
  consumptions: z.array(z.object({ supplyId: z.string().uuid(), consumedBase: decimalSchema })),
  warnings: z.array(z.object({ supplyId: z.string().uuid(), resultingStock: decimalSchema })),
});
```

Em `src/modules/production/production.routes.ts`:

```ts
// POST /productions
schema: {
  body: createProductionSchema,
  response: { 201: registerProductionResponseSchema, 400: errorSchema, 404: errorSchema, ...protectedErrors },
},

// GET /productions
schema: { response: { 200: productionListResponseSchema, ...protectedErrors } },

// GET /productions/:id
schema: {
  params: productionIdParamSchema,
  response: { 200: productionDetailResponseSchema, 404: errorSchema, ...protectedErrors },
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/docs/openapi.test.ts`
Expected: PASS — 19 testes

- [ ] **Step 5: Atualizar o teste de integração**

Em `tests/modules/production/production.routes.test.ts`, linhas 75, 76, 80 e 126:

```ts
expect(body.production.producedUnits).toBe(300);
expect(body.consumptions.find((c: { supplyId: string }) => c.supplyId === supplyId).consumedBase).toBe(3);
expect(supply.json().currentStock).toBe(7);
expect(body.producedUnits).toBe(100);
```

Run: `npx vitest run tests/modules/production/production.routes.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/production tests/docs/openapi.test.ts tests/modules/production
git commit -m "feat(production): document and enforce response schemas"
```

---

### Task 8: Health

**Files:**

- Create: `src/modules/health/health.schema.ts`
- Modify: `src/modules/health/health.routes.ts`
- Test: `tests/docs/openapi.test.ts`

**Interfaces:**

- Consumes: nada da Task 1 — o health não devolve decimal, timestamp nem erro no formato padrão.
- Produces: `healthResponseSchema`.

O 200 devolve `{ status: "ok", database: "up" }` e o 503 devolve `{ status: "error", database: "down" }`. Um schema com enums serve os dois.

- [ ] **Step 1: Write the failing test**

Acrescentar a `tests/docs/openapi.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/docs/openapi.test.ts -t "openapi: health"`
Expected: FAIL — `undefined` para os dois status

- [ ] **Step 3: Write minimal implementation**

`src/modules/health/health.schema.ts`:

```ts
import { z } from "zod";

/** Serve o 200 e o 503: só muda o valor de cada campo. */
export const healthResponseSchema = z.object({
  status: z.enum(["ok", "error"]),
  database: z.enum(["up", "down"]),
});
```

Em `src/modules/health/health.routes.ts`:

```ts
import { healthResponseSchema } from "./health.schema.js";

r.get(
  "/health",
  {
    config: { public: true },
    schema: { security: [], response: { 200: healthResponseSchema, 503: healthResponseSchema } },
  },
  handler,
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/docs/openapi.test.ts && npx vitest run tests/modules/health/health.routes.test.ts`
Expected: PASS — 20 testes no primeiro, o de health inalterado no segundo

- [ ] **Step 5: Commit**

```bash
git add src/modules/health tests/docs/openapi.test.ts
git commit -m "feat(health): document and enforce response schemas"
```

---

### Task 9: Auth

**Files:**

- Modify: `src/modules/auth/auth.schema.ts`
- Modify: `src/modules/auth/auth.routes.ts`
- Test: `tests/docs/openapi.test.ts`

**Interfaces:**

- Consumes: `errorSchema`, `noContentSchema` da Task 1; `permissionSchema` de `../users/roles.schema.js`.
- Produces: `sessionResponseSchema`, `meResponseSchema`.

`POST /sessions` tem rate limit e pode devolver 429 — status que hoje não aparece em documentação nenhuma. As rotas de sessão pública declaram só 401 e 429; `DELETE /sessions` e `GET /me` usam `requireAuth` e nunca devolvem 403, então **não** levam `...protectedErrors`.

- [ ] **Step 1: Write the failing test**

Acrescentar a `tests/docs/openapi.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/docs/openapi.test.ts -t "openapi: auth"`
Expected: FAIL — `undefined` nas asserções de schema

- [ ] **Step 3: Write minimal implementation**

Acrescentar a `src/modules/auth/auth.schema.ts`:

```ts
import { permissionSchema } from "../users/roles.schema.js";

export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

/** O que o auth.plugin monta em request.auth: identidade sem credencial. */
export const meResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  username: z.string(),
  email: z.string().email(),
  permissions: z.array(permissionSchema),
});
```

Em `src/modules/auth/auth.routes.ts`:

```ts
import { errorSchema, noContentSchema } from "../shared/response.js";
import { meResponseSchema, sessionResponseSchema } from "./auth.schema.js";

// POST /sessions
schema: {
  body: createSessionSchema,
  security: [],
  response: { 200: sessionResponseSchema, 400: errorSchema, 401: errorSchema, 429: errorSchema },
},

// POST /sessions/refresh
schema: {
  body: refreshSessionSchema,
  security: [],
  response: { 200: sessionResponseSchema, 400: errorSchema, 401: errorSchema },
},

// DELETE /sessions
schema: {
  body: refreshSessionSchema,
  response: { 204: noContentSchema, 400: errorSchema, 401: errorSchema },
},

// GET /me
schema: { response: { 200: meResponseSchema, 401: errorSchema } },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/docs/openapi.test.ts`
Expected: PASS — 25 testes

- [ ] **Step 5: Rodar a suíte de auth, que é a mais sensível a mudança de corpo**

Run: `npx vitest run tests/modules/auth`
Expected: PASS — inclusive `auth.rate-limit.test.ts`, que exercita o 429 agora declarado

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth tests/docs/openapi.test.ts
git commit -m "feat(auth): document and enforce response schemas"
```

---

### Task 10: Roles

**Files:**

- Modify: `src/modules/users/roles.schema.ts`
- Modify: `src/modules/users/roles.routes.ts`
- Test: `tests/docs/openapi.test.ts`

**Interfaces:**

- Consumes: `timestampSchema`, `errorSchema`, `noContentSchema`, `protectedErrors` da Task 1.
- Produces: `roleResponseSchema`, `roleListResponseSchema`.

O model `Role` não tem `description` — os campos são `id`, `name`, `permissions`, `createdAt`, `updatedAt`.

- [ ] **Step 1: Write the failing test**

Acrescentar a `tests/docs/openapi.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/docs/openapi.test.ts -t "openapi: roles"`
Expected: FAIL — `undefined` nas três asserções

- [ ] **Step 3: Write minimal implementation**

Acrescentar a `src/modules/users/roles.schema.ts`:

```ts
import { timestampSchema } from "../shared/response.js";

export const roleResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  permissions: z.array(permissionSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const roleListResponseSchema = z.array(roleResponseSchema);
```

Em `src/modules/users/roles.routes.ts`:

```ts
// GET /roles
schema: { response: { 200: roleListResponseSchema, ...protectedErrors } },

// POST /roles
schema: {
  body: createRoleSchema,
  response: { 201: roleResponseSchema, 400: errorSchema, 409: errorSchema, ...protectedErrors },
},

// PATCH /roles/:id
schema: {
  params: roleIdParamSchema,
  body: updateRoleSchema,
  response: { 200: roleResponseSchema, 400: errorSchema, 404: errorSchema, 409: errorSchema, ...protectedErrors },
},

// DELETE /roles/:id
schema: {
  params: roleIdParamSchema,
  response: { 204: noContentSchema, 404: errorSchema, 409: errorSchema, ...protectedErrors },
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/docs/openapi.test.ts && npx vitest run tests/modules/users/roles.routes.test.ts`
Expected: PASS — 28 testes no primeiro

- [ ] **Step 5: Commit**

```bash
git add src/modules/users/roles.schema.ts src/modules/users/roles.routes.ts tests/docs/openapi.test.ts
git commit -m "feat(roles): document and enforce response schemas"
```

---

### Task 11: Users e a trava contra vazamento de credencial

**Files:**

- Modify: `src/modules/users/users.schema.ts`
- Modify: `src/modules/users/users.routes.ts`
- Test: `tests/docs/openapi.test.ts`
- Test: `tests/modules/users/users.routes.test.ts` (acrescentar um teste)

**Interfaces:**

- Consumes: `timestampSchema`, `errorSchema`, `protectedErrors` da Task 1; `permissionSchema` de `./roles.schema.js`, já importado no arquivo.
- Produces: `userResponseSchema`, `userListResponseSchema`, `userPermissionsResponseSchema`.

`userResponseSchema` reproduz os dez `publicFields` de `users.repository.ts`. Ele é a trava real: hoje `passwordHash` só fica fora porque o repositório mantém o `select`; com o schema, o campo não sai nem se o `select` mudar.

- [ ] **Step 1: Write the failing test**

Acrescentar a `tests/docs/openapi.test.ts`:

```ts
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
```

E, em `tests/modules/users/users.routes.test.ts`, dentro do `describe` existente, um teste de vazamento que vale em tempo de execução — não só na documentação. O arquivo já tem um helper `createUser` e limpa pelo array `createdUserIds` (linha 11), que este teste reusa:

```ts
test("nenhuma rota de usuário devolve o hash da senha", async () => {
  const created = await app.inject({
    headers: actor.headers,
    method: "POST",
    url: "/users",
    payload: {
      name: "Leak Check",
      username: `leak-${crypto.randomUUID().slice(0, 8)}`,
      email: `leak-${crypto.randomUUID()}@example.test`,
      password: "senha-com-8-ou-mais",
    },
  });
  expect(created.statusCode).toBe(201);
  createdUserIds.push(created.json().id);
  expect(created.json()).not.toHaveProperty("passwordHash");

  const fetched = await app.inject({ headers: actor.headers, method: "GET", url: `/users/${created.json().id}` });
  expect(fetched.json()).not.toHaveProperty("passwordHash");

  const listed = await app.inject({ headers: actor.headers, method: "GET", url: "/users" });
  for (const user of listed.json()) expect(user).not.toHaveProperty("passwordHash");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/docs/openapi.test.ts -t "openapi: users"`
Expected: FAIL — `undefined` nas três asserções de documentação

- [ ] **Step 3: Write minimal implementation**

Acrescentar a `src/modules/users/users.schema.ts`:

```ts
import { timestampSchema } from "../shared/response.js";

/** Espelha os publicFields do repositório: tudo menos o hash da senha. */
export const userResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  username: z.string(),
  email: z.string().email(),
  roleId: z.string().uuid().nullable(),
  grantedPermissions: z.array(permissionSchema),
  deniedPermissions: z.array(permissionSchema),
  isActive: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const userListResponseSchema = z.array(userResponseSchema);

export const userPermissionsResponseSchema = z.object({
  userId: z.string().uuid(),
  permissions: z.array(permissionSchema),
});
```

Em `src/modules/users/users.routes.ts`:

```ts
// GET /users
schema: { response: { 200: userListResponseSchema, ...protectedErrors } },

// POST /users
schema: {
  body: createUserSchema,
  response: { 201: userResponseSchema, 400: errorSchema, 409: errorSchema, ...protectedErrors },
},

// GET /users/:id
schema: {
  params: userIdParamSchema,
  response: { 200: userResponseSchema, 404: errorSchema, ...protectedErrors },
},

// PATCH /users/:id
schema: {
  params: userIdParamSchema,
  body: updateUserSchema,
  response: { 200: userResponseSchema, 400: errorSchema, 404: errorSchema, 409: errorSchema, ...protectedErrors },
},

// GET /users/:id/permissions
schema: {
  params: userIdParamSchema,
  response: { 200: userPermissionsResponseSchema, 404: errorSchema, ...protectedErrors },
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/docs/openapi.test.ts && npx vitest run tests/modules/users/users.routes.test.ts`
Expected: PASS — 31 testes no primeiro; o de vazamento verde no segundo

- [ ] **Step 5: Commit**

```bash
git add src/modules/users tests/docs/openapi.test.ts tests/modules/users
git commit -m "feat(users): document and enforce response schemas"
```

---

### Task 12: Guarda-corpo global e documentação

Fecha a camada: um teste que vale para qualquer rota futura, e o ajuste do README que hoje afirma o contrário do novo contrato.

**Files:**

- Modify: `tests/docs/openapi.test.ts`
- Modify: `README.md:190-204` (seção _Domain rules_, item _Decimal arithmetic_)

**Interfaces:**

- Consumes: `operationsOf` de `tests/helpers/openapi.ts` (Task 1).
- Produces: nada.

- [ ] **Step 1: Write the failing test**

Acrescentar a `tests/docs/openapi.test.ts` (e incluir `operationsOf` no import do helper):

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/docs/openapi.test.ts -t "guarda-corpo"`
Expected: se as Tasks 2-11 estiverem completas, o primeiro teste já passa e só o segundo pode falhar por contagem. Se alguma rota tiver escapado, o primeiro teste falha listando exatamente quais — corrija a rota apontada antes de seguir. Esse é o resultado que este teste existe para produzir.

- [ ] **Step 3: Corrigir o que o teste apontar**

Não há implementação nova nesta task: o guarda-corpo é a verificação. Se a lista `missing` vier não vazia, volte à task do módulo correspondente e declare o `response` que faltou. Se a contagem não for 33, confira se alguma rota foi registrada duas vezes ou se o `routes.ts` mudou.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/docs/openapi.test.ts`
Expected: PASS — 33 testes

- [ ] **Step 5: Ajustar o README**

Na seção _Domain rules_, trocar o item _Decimal arithmetic_, hoje:

```markdown
- **Decimal arithmetic.** Money and quantities always use `Prisma.Decimal`; JavaScript `number` is never used in
  calculations.
```

por:

```markdown
- **Decimal arithmetic.** Money and quantities always use `Prisma.Decimal`; JavaScript `number` is never used in
  calculations. Only the HTTP boundary converts: response schemas serialize every decimal as a JSON number.
```

E acrescentar, logo abaixo do cabeçalho `## API` e antes da tabela de endpoints:

```markdown
Every route declares a response schema, so `/docs` carries the full contract of each body — including the error shapes
per status. The schema is enforced at serialization: a field that is not declared never reaches the client.
```

- [ ] **Step 6: Portão completo do projeto**

Run: `npm test && npx prettier --check .`
Expected: PASS — toda a suíte verde e formatação limpa. Cole a saída.

- [ ] **Step 7: Commit**

```bash
git add tests/docs/openapi.test.ts README.md
git commit -m "test(docs): require a response schema on every route"
```

---

## Ordem e dependências

```
Task 1 (fundação)
  └─ Task 2 (supplies) ──┬─ Task 3 (recipes) ─── Task 4 (pricing)
                         ├─ Task 5 (stock) ──┬─ Task 6 (waste)
                         │                   └─ Task 7 (production)
                         └─ (independentes) Task 8 (health), Task 9 (auth),
                                            Task 10 (roles) ─── Task 11 (users)
Task 12 (guarda-corpo) — depende de todas
```

Tasks 8, 9 e 10 não dependem de 2 a 7 e podem ser feitas em qualquer ponto depois da Task 1. A Task 11 depende da 10 só pelo `permissionSchema`, que já existe hoje — na prática também é independente.

## Fora de escopo

- Unificar o 400 de validação do Zod no formato `{ message, code }`
- Paginação, filtros ou envelopes de coleção
- `examples` e descrições por campo no OpenAPI
- Versionamento da API
