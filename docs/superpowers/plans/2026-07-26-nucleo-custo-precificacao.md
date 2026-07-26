# Núcleo de Custo e Precificação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o módulo vertical de Insumos (`Supply`) + Fichas Técnicas (`Recipe`) + Precificação, que calcula o custo por cento e sugere preço de venda (cento e meio-cento) via markup.

**Architecture:** API Fastify em módulos (`supplies`, `recipes`, `pricing`) sobre Prisma/PostgreSQL. A lógica de valor — conversão de unidades, custo e precificação — vive em **funções puras** (testáveis sem banco), consumidas por services que orquestram os repositories Prisma. Toda aritmética monetária usa `Prisma.Decimal` (exato), nunca `number` do JS.

**Tech Stack:** TypeScript (ESM, `nodenext`), Fastify 5, `fastify-type-provider-zod` + Zod 4, Prisma 6 + PostgreSQL, Vitest.

## Global Constraints

- **Idioma:** identificadores de código em **inglês** (models, fields, enums, endpoints, pastas, variáveis); documentação/comentários de negócio em português.
- **Dinheiro:** `Prisma.Decimal` (coluna `Decimal`/`NUMERIC`) em todo valor monetário. **Proibido** coagir dinheiro para `number` do JS em qualquer aritmética.
- **Unidades:** nunca texto livre. Sempre o enum `UnitOfMeasure`, cujo metadado (`dimension`, `factorToBase`) vive em código estático.
- **Validação de dimensão (rígida):** consumo de insumo só é permitido em unidade da **mesma `dimension`** do insumo. Conversão peso↔volume é proibida.
- **ESM:** imports relativos usam extensão `.js`.
- **TDD:** para cada função pura — teste que falha → rodar e ver falhar → implementação mínima → ver passar → commit.
- **Commits:** Conventional Commits (o repo usa commitlint). Rodar `git add` explícito dos arquivos citados.

---

### Task 1: Setup — Prisma, PostgreSQL, Vitest e schema inicial

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/lib/prisma.ts`
- Create: `vitest.config.ts`
- Create: `src/lib/prisma.smoke.test.ts`
- Create: `docker-compose.yml` (PostgreSQL 17 alpine)
- Modify: `package.json` (deps + scripts)
- Modify: `.example.env` (DATABASE_URL)
- Create: `.env` (local, não versionado — já ignorado pelo `.gitignore`)

**Interfaces:**
- Produces: `prisma` (default export de `src/lib/prisma.ts`) — instância singleton de `PrismaClient`.
- Produces: enums/tipos gerados em `src/generated/prisma/index.js` — `PrismaClient`, `Prisma` (namespace com `Prisma.Decimal`), `UnitOfMeasure`, `SupplyType`, e os models `Supply`, `Recipe`, `RecipeItem`.

- [ ] **Step 1: Instalar dependências**

```bash
npm install @prisma/client
npm install -D prisma vitest
```

- [ ] **Step 2: Adicionar scripts ao `package.json`**

Adicionar em `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest",
"db:migrate": "prisma migrate dev",
"db:generate": "prisma generate"
```

- [ ] **Step 3: Criar `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Criar `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum SupplyType {
  INGREDIENT
  PACKAGING
}

enum UnitOfMeasure {
  G
  KG
  ML
  L
  UN
}

model Supply {
  id            String        @id @default(uuid())
  name          String
  type          SupplyType
  purchaseUnit  UnitOfMeasure
  purchaseQty   Decimal
  purchasePrice Decimal
  recipeItems   RecipeItem[]
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
}

model Recipe {
  id                  String       @id @default(uuid())
  name                String
  batchYield          Decimal
  laborCostPerHundred Decimal
  margin              Decimal
  items               RecipeItem[]
  createdAt           DateTime     @default(now())
  updatedAt           DateTime     @updatedAt
}

model RecipeItem {
  id        String        @id @default(uuid())
  recipeId  String
  recipe    Recipe        @relation(fields: [recipeId], references: [id], onDelete: Cascade)
  supplyId  String
  supply    Supply        @relation(fields: [supplyId], references: [id], onDelete: Restrict)
  usageQty  Decimal
  usageUnit UnitOfMeasure
}
```

- [ ] **Step 5: Criar `docker-compose.yml` (PostgreSQL 17 alpine)**

```yaml
services:
  postgres:
    image: postgres:17-alpine
    container_name: wa-api-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: wa_api
    ports:
      - "5432:5432"
    volumes:
      - wa-api-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d wa_api"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  wa-api-pgdata:
```

- [ ] **Step 6: Configurar `DATABASE_URL`**

Adicionar em `.example.env`:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/wa_api?schema=public"
```

Criar `.env` local com a mesma URL (o `.gitignore` já ignora `.env`).

- [ ] **Step 7: Subir o PostgreSQL**

Run: `docker compose up -d --wait`
Expected: container `wa-api-postgres` saudável (healthcheck ok); porta 5432 acessível.

- [ ] **Step 8: Rodar a migração inicial e gerar o client**

Run: `npm run db:migrate -- --name init`
Expected: cria `prisma/migrations/*_init/`, aplica no banco e gera o client em `src/generated/prisma`.

- [ ] **Step 9: Criar o singleton do Prisma `src/lib/prisma.ts`**

```ts
import { PrismaClient } from "../generated/prisma/index.js";

const prisma = new PrismaClient();

export default prisma;
```

- [ ] **Step 10: Escrever smoke test `src/lib/prisma.smoke.test.ts`**

```ts
import { expect, test } from "vitest";
import { Prisma } from "../generated/prisma/index.js";

test("Prisma.Decimal faz aritmética exata", () => {
  const total = new Prisma.Decimal("0.1").add("0.2");
  expect(total.equals("0.3")).toBe(true);
});
```

- [ ] **Step 11: Rodar o teste**

Run: `npm test`
Expected: PASS (confirma que o client foi gerado e o Vitest roda TS/ESM).

- [ ] **Step 12: Ignorar o client gerado no git**

Adicionar `src/generated/` ao `.gitignore`.

- [ ] **Step 13: Commit**

```bash
git add docker-compose.yml package.json package-lock.json vitest.config.ts prisma/schema.prisma prisma/migrations .example.env .gitignore src/lib/prisma.ts src/lib/prisma.smoke.test.ts
git commit -m "chore: configura prisma, postgresql e vitest"
```

---

### Task 2: `shared/unit-of-measure` — metadado e conversão de unidades

**Files:**
- Create: `src/modules/shared/unit-of-measure.ts`
- Test: `src/modules/shared/unit-of-measure.test.ts`

**Interfaces:**
- Consumes: `UnitOfMeasure`, `Prisma` de `src/generated/prisma/index.js`.
- Produces:
  - `type Dimension = "WEIGHT" | "VOLUME" | "COUNT"`
  - `UNIT_METADATA: Record<UnitOfMeasure, { dimension: Dimension; factorToBase: number }>`
  - `dimensionOf(unit: UnitOfMeasure): Dimension`
  - `sameDimension(a: UnitOfMeasure, b: UnitOfMeasure): boolean`
  - `toBase(qty: Prisma.Decimal, unit: UnitOfMeasure): Prisma.Decimal` — `qty × factorToBase`

- [ ] **Step 1: Escrever o teste que falha**

`src/modules/shared/unit-of-measure.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { Prisma, UnitOfMeasure } from "../../generated/prisma/index.js";
import { dimensionOf, sameDimension, toBase } from "./unit-of-measure.js";

describe("unit-of-measure", () => {
  test("KG pertence à dimensão WEIGHT", () => {
    expect(dimensionOf(UnitOfMeasure.KG)).toBe("WEIGHT");
  });

  test("G e KG compartilham dimensão; G e ML não", () => {
    expect(sameDimension(UnitOfMeasure.G, UnitOfMeasure.KG)).toBe(true);
    expect(sameDimension(UnitOfMeasure.G, UnitOfMeasure.ML)).toBe(false);
  });

  test("toBase converte KG para gramas (×1000)", () => {
    expect(toBase(new Prisma.Decimal(1), UnitOfMeasure.KG).equals(1000)).toBe(true);
  });

  test("toBase mantém unidade base (G, fator 1)", () => {
    expect(toBase(new Prisma.Decimal(200), UnitOfMeasure.G).equals(200)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/shared/unit-of-measure.test.ts`
Expected: FAIL (módulo `./unit-of-measure.js` inexistente).

- [ ] **Step 3: Implementar `src/modules/shared/unit-of-measure.ts`**

```ts
import { Prisma, UnitOfMeasure } from "../../generated/prisma/index.js";

export type Dimension = "WEIGHT" | "VOLUME" | "COUNT";

export const UNIT_METADATA: Record<UnitOfMeasure, { dimension: Dimension; factorToBase: number }> = {
  G: { dimension: "WEIGHT", factorToBase: 1 },
  KG: { dimension: "WEIGHT", factorToBase: 1000 },
  ML: { dimension: "VOLUME", factorToBase: 1 },
  L: { dimension: "VOLUME", factorToBase: 1000 },
  UN: { dimension: "COUNT", factorToBase: 1 },
};

export function dimensionOf(unit: UnitOfMeasure): Dimension {
  return UNIT_METADATA[unit].dimension;
}

export function sameDimension(a: UnitOfMeasure, b: UnitOfMeasure): boolean {
  return dimensionOf(a) === dimensionOf(b);
}

export function toBase(qty: Prisma.Decimal, unit: UnitOfMeasure): Prisma.Decimal {
  return qty.mul(UNIT_METADATA[unit].factorToBase);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/shared/unit-of-measure.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/shared/unit-of-measure.ts src/modules/shared/unit-of-measure.test.ts
git commit -m "feat: adiciona conversao e dimensao de unidades"
```

---

### Task 3: `shared/money` — arredondamento monetário exato

**Files:**
- Create: `src/modules/shared/money.ts`
- Test: `src/modules/shared/money.test.ts`

**Interfaces:**
- Consumes: `Prisma` de `src/generated/prisma/index.js`.
- Produces:
  - `ONE_REAL: Prisma.Decimal` — passo padrão de R$1,00.
  - `roundUpToNearest(value: Prisma.Decimal, step: Prisma.Decimal): Prisma.Decimal` — arredonda `value` para cima ao múltiplo de `step`.

- [ ] **Step 1: Escrever o teste que falha**

`src/modules/shared/money.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { Prisma } from "../../generated/prisma/index.js";
import { ONE_REAL, roundUpToNearest } from "./money.js";

describe("money.roundUpToNearest", () => {
  test("arredonda 103,73 para cima → 104", () => {
    expect(roundUpToNearest(new Prisma.Decimal("103.73"), ONE_REAL).equals(104)).toBe(true);
  });

  test("valor já inteiro não muda", () => {
    expect(roundUpToNearest(new Prisma.Decimal("52"), ONE_REAL).equals(52)).toBe(true);
  });

  test("52,01 → 53", () => {
    expect(roundUpToNearest(new Prisma.Decimal("52.01"), ONE_REAL).equals(53)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/shared/money.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `src/modules/shared/money.ts`**

```ts
import { Prisma } from "../../generated/prisma/index.js";

export const ONE_REAL = new Prisma.Decimal(1);

// Arredonda para cima ao múltiplo de `step` (ex.: R$1,00), mantendo exatidão Decimal.
export function roundUpToNearest(value: Prisma.Decimal, step: Prisma.Decimal): Prisma.Decimal {
  return value.div(step).ceil().mul(step);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/shared/money.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/shared/money.ts src/modules/shared/money.test.ts
git commit -m "feat: adiciona arredondamento monetario decimal"
```

---

### Task 4: Módulo `supplies` — custo do insumo e CRUD

**Files:**
- Create: `src/modules/supplies/supplies.cost.ts` (função pura `costPerBase`)
- Test: `src/modules/supplies/supplies.cost.test.ts`
- Create: `src/modules/supplies/supplies.schema.ts` (Zod)
- Create: `src/modules/supplies/supplies.repository.ts`
- Create: `src/modules/supplies/supplies.routes.ts`
- Modify: `src/routes.ts` (registrar o router)

**Interfaces:**
- Consumes: `toBase` de `shared/unit-of-measure.js`; `prisma` de `src/lib/prisma.js`; `Prisma`, `UnitOfMeasure`, `SupplyType` do client gerado.
- Produces:
  - `interface SupplyCostInput { purchasePrice: Prisma.Decimal; purchaseQty: Prisma.Decimal; purchaseUnit: UnitOfMeasure }`
  - `costPerBase(supply: SupplyCostInput): Prisma.Decimal` — `purchasePrice ÷ toBase(purchaseQty, purchaseUnit)`
  - `createSupplySchema`, `updateSupplySchema` (Zod) e tipos inferidos.
  - Rotas: `POST /supplies`, `GET /supplies`, `GET /supplies/:id`, `PATCH /supplies/:id`, `DELETE /supplies/:id`.

- [ ] **Step 1: Escrever o teste que falha (custo por base)**

`src/modules/supplies/supplies.cost.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { Prisma, UnitOfMeasure } from "../../generated/prisma/index.js";
import { costPerBase } from "./supplies.cost.js";

describe("costPerBase", () => {
  test("chocolate: R$12,00 por 1 KG → R$0,012 por grama", () => {
    const result = costPerBase({
      purchasePrice: new Prisma.Decimal("12.00"),
      purchaseQty: new Prisma.Decimal(1),
      purchaseUnit: UnitOfMeasure.KG,
    });
    expect(result.equals("0.012")).toBe(true);
  });

  test("forminha: R$5,00 por 100 UN → R$0,05 por unidade", () => {
    const result = costPerBase({
      purchasePrice: new Prisma.Decimal("5.00"),
      purchaseQty: new Prisma.Decimal(100),
      purchaseUnit: UnitOfMeasure.UN,
    });
    expect(result.equals("0.05")).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/supplies/supplies.cost.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `src/modules/supplies/supplies.cost.ts`**

```ts
import { Prisma, UnitOfMeasure } from "../../generated/prisma/index.js";
import { toBase } from "../shared/unit-of-measure.js";

export interface SupplyCostInput {
  purchasePrice: Prisma.Decimal;
  purchaseQty: Prisma.Decimal;
  purchaseUnit: UnitOfMeasure;
}

// Custo por unidade base (grama/ml/unidade) do insumo.
export function costPerBase(supply: SupplyCostInput): Prisma.Decimal {
  return supply.purchasePrice.div(toBase(supply.purchaseQty, supply.purchaseUnit));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/supplies/supplies.cost.test.ts`
Expected: PASS.

- [ ] **Step 5: Criar os schemas Zod `src/modules/supplies/supplies.schema.ts`**

```ts
import { z } from "zod";

export const supplyTypeSchema = z.enum(["INGREDIENT", "PACKAGING"]);
export const unitOfMeasureSchema = z.enum(["G", "KG", "ML", "L", "UN"]);

export const createSupplySchema = z.object({
  name: z.string().min(1),
  type: supplyTypeSchema,
  purchaseUnit: unitOfMeasureSchema,
  purchaseQty: z.number().positive(),
  purchasePrice: z.number().nonnegative(),
});

export const updateSupplySchema = createSupplySchema.partial();

export const supplyIdParamSchema = z.object({ id: z.string().uuid() });

export type CreateSupplyInput = z.infer<typeof createSupplySchema>;
export type UpdateSupplyInput = z.infer<typeof updateSupplySchema>;
```

> Nota: valores monetários chegam como `number` no boundary JSON e são convertidos para `Prisma.Decimal` imediatamente no repository (a proibição de `number` vale para **aritmética**, não para o parse de entrada).

- [ ] **Step 6: Criar o repository `src/modules/supplies/supplies.repository.ts`**

```ts
import prisma from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/index.js";
import type { CreateSupplyInput, UpdateSupplyInput } from "./supplies.schema.js";

export function listSupplies() {
  return prisma.supply.findMany({ orderBy: { name: "asc" } });
}

export function getSupply(id: string) {
  return prisma.supply.findUnique({ where: { id } });
}

export function createSupply(data: CreateSupplyInput) {
  return prisma.supply.create({
    data: {
      name: data.name,
      type: data.type,
      purchaseUnit: data.purchaseUnit,
      purchaseQty: new Prisma.Decimal(data.purchaseQty),
      purchasePrice: new Prisma.Decimal(data.purchasePrice),
    },
  });
}

export function updateSupply(id: string, data: UpdateSupplyInput) {
  return prisma.supply.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.type !== undefined && { type: data.type }),
      ...(data.purchaseUnit !== undefined && { purchaseUnit: data.purchaseUnit }),
      ...(data.purchaseQty !== undefined && { purchaseQty: new Prisma.Decimal(data.purchaseQty) }),
      ...(data.purchasePrice !== undefined && { purchasePrice: new Prisma.Decimal(data.purchasePrice) }),
    },
  });
}

export function deleteSupply(id: string) {
  return prisma.supply.delete({ where: { id } });
}
```

- [ ] **Step 7: Criar as rotas `src/modules/supplies/supplies.routes.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  createSupplySchema,
  updateSupplySchema,
  supplyIdParamSchema,
} from "./supplies.schema.js";
import * as repo from "./supplies.repository.js";

export default async function supplyRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/supplies", async () => repo.listSupplies());

  r.post("/supplies", { schema: { body: createSupplySchema } }, async (req, reply) => {
    const supply = await repo.createSupply(req.body);
    return reply.status(201).send(supply);
  });

  r.get("/supplies/:id", { schema: { params: supplyIdParamSchema } }, async (req, reply) => {
    const supply = await repo.getSupply(req.params.id);
    if (!supply) return reply.status(404).send({ message: "Supply not found" });
    return supply;
  });

  r.patch(
    "/supplies/:id",
    { schema: { params: supplyIdParamSchema, body: updateSupplySchema } },
    async (req) => repo.updateSupply(req.params.id, req.body),
  );

  r.delete("/supplies/:id", { schema: { params: supplyIdParamSchema } }, async (req, reply) => {
    await repo.deleteSupply(req.params.id);
    return reply.status(204).send();
  });
}
```

- [ ] **Step 8: Registrar o router em `src/routes.ts`**

```ts
import { FastifyInstance } from "fastify";
import supplyRoutes from "./modules/supplies/supplies.routes.js";

export default async function (app: FastifyInstance) {
  await app.register(supplyRoutes);
}
```

- [ ] **Step 9: Verificar o build de tipos**

Run: `npx tsc --noEmit`
Expected: sem erros de tipo.

- [ ] **Step 10: Commit**

```bash
git add src/modules/supplies src/routes.ts
git commit -m "feat: adiciona modulo supplies com custo e crud"
```

---

### Task 5: Módulo `recipes` — CRUD, itens e validação de dimensão

**Files:**
- Create: `src/modules/recipes/recipes.validation.ts` (função pura `assertItemDimension`)
- Test: `src/modules/recipes/recipes.validation.test.ts`
- Create: `src/modules/recipes/recipes.schema.ts` (Zod)
- Create: `src/modules/recipes/recipes.repository.ts`
- Create: `src/modules/recipes/recipes.routes.ts`
- Modify: `src/routes.ts` (registrar o router)

**Interfaces:**
- Consumes: `sameDimension` de `shared/unit-of-measure.js`; `getSupply` de `supplies/supplies.repository.js`; `prisma`; `Prisma`, `UnitOfMeasure`.
- Produces:
  - `class DimensionMismatchError extends Error` — com `code = "DIMENSION_MISMATCH"`.
  - `assertItemDimension(supplyUnit: UnitOfMeasure, usageUnit: UnitOfMeasure): void` — lança `DimensionMismatchError` se dimensões diferem.
  - `createRecipeSchema`, `updateMarginSchema`, tipos inferidos.
  - `getRecipeWithItems(id)` — retorna `Recipe` com `items` incluindo `supply` (consumido pelo módulo `pricing`).
  - Rotas: `POST /recipes`, `GET /recipes`, `GET /recipes/:id`, `PATCH /recipes/:id`, `DELETE /recipes/:id`, `PATCH /recipes/:id/margin`.

- [ ] **Step 1: Escrever o teste que falha (validação de dimensão)**

`src/modules/recipes/recipes.validation.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { UnitOfMeasure } from "../../generated/prisma/index.js";
import { assertItemDimension, DimensionMismatchError } from "./recipes.validation.js";

describe("assertItemDimension", () => {
  test("mesma dimensão (KG comprado, G usado) não lança", () => {
    expect(() => assertItemDimension(UnitOfMeasure.KG, UnitOfMeasure.G)).not.toThrow();
  });

  test("dimensões diferentes (KG comprado, ML usado) lança DimensionMismatchError", () => {
    expect(() => assertItemDimension(UnitOfMeasure.KG, UnitOfMeasure.ML)).toThrow(
      DimensionMismatchError,
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/recipes/recipes.validation.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `src/modules/recipes/recipes.validation.ts`**

```ts
import { UnitOfMeasure } from "../../generated/prisma/index.js";
import { sameDimension } from "../shared/unit-of-measure.js";

export class DimensionMismatchError extends Error {
  readonly code = "DIMENSION_MISMATCH";
  constructor(supplyUnit: UnitOfMeasure, usageUnit: UnitOfMeasure) {
    super(`Não é possível consumir em ${usageUnit} um insumo medido em ${supplyUnit} (dimensões diferentes).`);
    this.name = "DimensionMismatchError";
  }
}

export function assertItemDimension(supplyUnit: UnitOfMeasure, usageUnit: UnitOfMeasure): void {
  if (!sameDimension(supplyUnit, usageUnit)) {
    throw new DimensionMismatchError(supplyUnit, usageUnit);
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/recipes/recipes.validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Criar os schemas Zod `src/modules/recipes/recipes.schema.ts`**

```ts
import { z } from "zod";
import { unitOfMeasureSchema } from "../supplies/supplies.schema.js";

export const recipeItemSchema = z.object({
  supplyId: z.string().uuid(),
  usageQty: z.number().positive(),
  usageUnit: unitOfMeasureSchema,
});

export const createRecipeSchema = z.object({
  name: z.string().min(1),
  batchYield: z.number().positive(),
  laborCostPerHundred: z.number().nonnegative(),
  margin: z.number().nonnegative(),
  items: z.array(recipeItemSchema).min(1),
});

export const updateMarginSchema = z.object({ margin: z.number().nonnegative() });

export const recipeIdParamSchema = z.object({ id: z.string().uuid() });

export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;
```

- [ ] **Step 6: Criar o repository `src/modules/recipes/recipes.repository.ts`**

```ts
import prisma from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/index.js";
import type { CreateRecipeInput } from "./recipes.schema.js";

export function listRecipes() {
  return prisma.recipe.findMany({ orderBy: { name: "asc" } });
}

// Usado pelo módulo pricing: inclui itens e o supply de cada item.
export function getRecipeWithItems(id: string) {
  return prisma.recipe.findUnique({
    where: { id },
    include: { items: { include: { supply: true } } },
  });
}

export function createRecipe(data: CreateRecipeInput) {
  return prisma.recipe.create({
    data: {
      name: data.name,
      batchYield: new Prisma.Decimal(data.batchYield),
      laborCostPerHundred: new Prisma.Decimal(data.laborCostPerHundred),
      margin: new Prisma.Decimal(data.margin),
      items: {
        create: data.items.map((item) => ({
          supplyId: item.supplyId,
          usageQty: new Prisma.Decimal(item.usageQty),
          usageUnit: item.usageUnit,
        })),
      },
    },
    include: { items: true },
  });
}

export function updateMargin(id: string, margin: number) {
  return prisma.recipe.update({
    where: { id },
    data: { margin: new Prisma.Decimal(margin) },
  });
}

export function deleteRecipe(id: string) {
  return prisma.recipe.delete({ where: { id } });
}
```

- [ ] **Step 7: Criar as rotas `src/modules/recipes/recipes.routes.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  createRecipeSchema,
  updateMarginSchema,
  recipeIdParamSchema,
} from "./recipes.schema.js";
import { assertItemDimension, DimensionMismatchError } from "./recipes.validation.js";
import * as recipeRepo from "./recipes.repository.js";
import { getSupply } from "../supplies/supplies.repository.js";

export default async function recipeRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/recipes", async () => recipeRepo.listRecipes());

  r.post("/recipes", { schema: { body: createRecipeSchema } }, async (req, reply) => {
    // Valida a dimensão de cada item contra o insumo referenciado.
    for (const item of req.body.items) {
      const supply = await getSupply(item.supplyId);
      if (!supply) {
        return reply.status(400).send({ message: `Supply ${item.supplyId} not found` });
      }
      try {
        assertItemDimension(supply.purchaseUnit, item.usageUnit);
      } catch (err) {
        if (err instanceof DimensionMismatchError) {
          return reply.status(400).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    }
    const recipe = await recipeRepo.createRecipe(req.body);
    return reply.status(201).send(recipe);
  });

  r.get("/recipes/:id", { schema: { params: recipeIdParamSchema } }, async (req, reply) => {
    const recipe = await recipeRepo.getRecipeWithItems(req.params.id);
    if (!recipe) return reply.status(404).send({ message: "Recipe not found" });
    return recipe;
  });

  r.patch(
    "/recipes/:id/margin",
    { schema: { params: recipeIdParamSchema, body: updateMarginSchema } },
    async (req) => recipeRepo.updateMargin(req.params.id, req.body.margin),
  );

  r.delete("/recipes/:id", { schema: { params: recipeIdParamSchema } }, async (req, reply) => {
    await recipeRepo.deleteRecipe(req.params.id);
    return reply.status(204).send();
  });
}
```

- [ ] **Step 8: Registrar o router em `src/routes.ts`**

```ts
import { FastifyInstance } from "fastify";
import supplyRoutes from "./modules/supplies/supplies.routes.js";
import recipeRoutes from "./modules/recipes/recipes.routes.js";

export default async function (app: FastifyInstance) {
  await app.register(supplyRoutes);
  await app.register(recipeRoutes);
}
```

- [ ] **Step 9: Verificar o build de tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 10: Commit**

```bash
git add src/modules/recipes src/routes.ts
git commit -m "feat: adiciona modulo recipes com itens e validacao de dimensao"
```

---

### Task 6: Módulo `pricing` — cálculo de custo e preço

**Files:**
- Create: `src/modules/pricing/pricing.calc.ts` (função pura `calculatePricing`)
- Test: `src/modules/pricing/pricing.calc.test.ts`
- Create: `src/modules/pricing/pricing.routes.ts`
- Modify: `src/routes.ts` (registrar o router)

**Interfaces:**
- Consumes: `toBase` de `shared/unit-of-measure.js`; `costPerBase`, `SupplyCostInput` de `supplies/supplies.cost.js`; `ONE_REAL`, `roundUpToNearest` de `shared/money.js`; `getRecipeWithItems` de `recipes/recipes.repository.js`; `Prisma`, `UnitOfMeasure`.
- Produces:
  - `interface RecipeItemForPricing { usageQty: Prisma.Decimal; usageUnit: UnitOfMeasure; supply: SupplyCostInput }`
  - `interface RecipeForPricing { batchYield: Prisma.Decimal; laborCostPerHundred: Prisma.Decimal; margin: Prisma.Decimal; items: RecipeItemForPricing[] }`
  - `interface PricingResult { suppliesCostPerHundred: Prisma.Decimal; totalCostPerHundred: Prisma.Decimal; exactPrice: Prisma.Decimal; pricePerHundred: Prisma.Decimal; pricePerHalfHundred: Prisma.Decimal }`
  - `calculatePricing(recipe: RecipeForPricing): PricingResult`
  - Rota: `GET /recipes/:id/pricing`.

- [ ] **Step 1: Escrever o teste que falha (exemplo do brigadeiro, §5.3 da spec)**

`src/modules/pricing/pricing.calc.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { Prisma, UnitOfMeasure } from "../../generated/prisma/index.js";
import { calculatePricing } from "./pricing.calc.js";

describe("calculatePricing (cento de brigadeiro)", () => {
  // Lote de 100 un que consome R$45 em insumos (1 insumo: R$45 por 1 UN, usa 1 UN).
  const recipe = {
    batchYield: new Prisma.Decimal(100),
    laborCostPerHundred: new Prisma.Decimal("20.00"),
    margin: new Prisma.Decimal("0.60"),
    items: [
      {
        usageQty: new Prisma.Decimal(1),
        usageUnit: UnitOfMeasure.UN,
        supply: {
          purchasePrice: new Prisma.Decimal("45.00"),
          purchaseQty: new Prisma.Decimal(1),
          purchaseUnit: UnitOfMeasure.UN,
        },
      },
    ],
  };

  test("custo total por cento = R$65", () => {
    expect(calculatePricing(recipe).totalCostPerHundred.equals("65")).toBe(true);
  });

  test("preço exato (markup 60%) = R$104", () => {
    expect(calculatePricing(recipe).exactPrice.equals("104")).toBe(true);
  });

  test("preço do cento arredondado = R$104", () => {
    expect(calculatePricing(recipe).pricePerHundred.equals("104")).toBe(true);
  });

  test("preço do meio-cento = R$52", () => {
    expect(calculatePricing(recipe).pricePerHalfHundred.equals("52")).toBe(true);
  });

  test("arredondamento pra cima: custo 40 margem 0,6 → exato 64 fica 64; 40,10 vira 65", () => {
    const r2 = { ...recipe, laborCostPerHundred: new Prisma.Decimal("0.10"), items: recipe.items };
    // suppliesPerHundred 45 + 0,10 = 45,10; ×1,6 = 72,16 → arredonda 73
    expect(calculatePricing(r2).pricePerHundred.equals("73")).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/pricing/pricing.calc.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `src/modules/pricing/pricing.calc.ts`**

```ts
import { Prisma, UnitOfMeasure } from "../../generated/prisma/index.js";
import { toBase } from "../shared/unit-of-measure.js";
import { costPerBase, type SupplyCostInput } from "../supplies/supplies.cost.js";
import { ONE_REAL, roundUpToNearest } from "../shared/money.js";

export interface RecipeItemForPricing {
  usageQty: Prisma.Decimal;
  usageUnit: UnitOfMeasure;
  supply: SupplyCostInput;
}

export interface RecipeForPricing {
  batchYield: Prisma.Decimal;
  laborCostPerHundred: Prisma.Decimal;
  margin: Prisma.Decimal;
  items: RecipeItemForPricing[];
}

export interface PricingResult {
  suppliesCostPerHundred: Prisma.Decimal;
  totalCostPerHundred: Prisma.Decimal;
  exactPrice: Prisma.Decimal;
  pricePerHundred: Prisma.Decimal;
  pricePerHalfHundred: Prisma.Decimal;
}

export function calculatePricing(recipe: RecipeForPricing): PricingResult {
  const suppliesCostPerBatch = recipe.items.reduce(
    (acc, item) => acc.add(toBase(item.usageQty, item.usageUnit).mul(costPerBase(item.supply))),
    new Prisma.Decimal(0),
  );

  const hundreds = recipe.batchYield.div(100);
  const suppliesCostPerHundred = suppliesCostPerBatch.div(hundreds);
  const totalCostPerHundred = suppliesCostPerHundred.add(recipe.laborCostPerHundred);

  const exactPrice = totalCostPerHundred.mul(ONE_REAL.add(recipe.margin));
  const pricePerHundred = roundUpToNearest(exactPrice, ONE_REAL);
  const pricePerHalfHundred = roundUpToNearest(pricePerHundred.div(2), ONE_REAL);

  return {
    suppliesCostPerHundred,
    totalCostPerHundred,
    exactPrice,
    pricePerHundred,
    pricePerHalfHundred,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/pricing/pricing.calc.test.ts`
Expected: PASS.

- [ ] **Step 5: Criar as rotas `src/modules/pricing/pricing.routes.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getRecipeWithItems } from "../recipes/recipes.repository.js";
import { calculatePricing } from "./pricing.calc.js";

const recipeIdParamSchema = z.object({ id: z.string().uuid() });

export default async function pricingRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/recipes/:id/pricing", { schema: { params: recipeIdParamSchema } }, async (req, reply) => {
    const recipe = await getRecipeWithItems(req.params.id);
    if (!recipe) return reply.status(404).send({ message: "Recipe not found" });

    const result = calculatePricing(recipe);

    // Serializa os Decimal como string para preservar exatidão na resposta.
    return {
      suppliesCostPerHundred: result.suppliesCostPerHundred.toFixed(2),
      totalCostPerHundred: result.totalCostPerHundred.toFixed(2),
      exactPrice: result.exactPrice.toFixed(2),
      pricePerHundred: result.pricePerHundred.toFixed(2),
      pricePerHalfHundred: result.pricePerHalfHundred.toFixed(2),
    };
  });
}
```

- [ ] **Step 6: Registrar o router em `src/routes.ts`**

```ts
import { FastifyInstance } from "fastify";
import supplyRoutes from "./modules/supplies/supplies.routes.js";
import recipeRoutes from "./modules/recipes/recipes.routes.js";
import pricingRoutes from "./modules/pricing/pricing.routes.js";

export default async function (app: FastifyInstance) {
  await app.register(supplyRoutes);
  await app.register(recipeRoutes);
  await app.register(pricingRoutes);
}
```

- [ ] **Step 7: Verificar o build de tipos e rodar toda a suíte**

Run: `npx tsc --noEmit && npm test`
Expected: sem erros de tipo; todos os testes PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/pricing src/routes.ts
git commit -m "feat: adiciona modulo pricing com calculo de custo e preco"
```

---

### Task 7: Verificação manual ponta a ponta (smoke)

**Files:** nenhum (validação manual da API rodando).

**Interfaces:**
- Consumes: todas as rotas registradas.

- [ ] **Step 1: Subir a API**

Run: `npm run dev`
Expected: "Server is running"; Swagger em `http://localhost:3333/docs`.

- [ ] **Step 2: Criar um insumo**

```bash
curl -s -X POST http://localhost:3333/supplies -H "Content-Type: application/json" \
  -d '{"name":"Massa de brigadeiro (lote)","type":"INGREDIENT","purchaseUnit":"UN","purchaseQty":1,"purchasePrice":45.00}'
```
Expected: 201 com `id`. Guardar o `id` retornado.

- [ ] **Step 3: Criar uma receita usando esse insumo**

```bash
curl -s -X POST http://localhost:3333/recipes -H "Content-Type: application/json" \
  -d '{"name":"Brigadeiro tradicional","batchYield":100,"laborCostPerHundred":20.00,"margin":0.60,"items":[{"supplyId":"<ID_DO_INSUMO>","usageQty":1,"usageUnit":"UN"}]}'
```
Expected: 201 com `id`. Guardar o `id` da receita.

- [ ] **Step 4: Consultar a precificação**

```bash
curl -s http://localhost:3333/recipes/<ID_DA_RECEITA>/pricing
```
Expected: `totalCostPerHundred: "65.00"`, `pricePerHundred: "104.00"`, `pricePerHalfHundred: "52.00"`.

- [ ] **Step 5: Validar a trava de dimensão (deve falhar)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3333/recipes -H "Content-Type: application/json" \
  -d '{"name":"Inválida","batchYield":100,"laborCostPerHundred":10,"margin":0.5,"items":[{"supplyId":"<ID_DO_INSUMO>","usageQty":100,"usageUnit":"ML"}]}'
```
Expected: `400` (insumo em `UN`/COUNT não aceita consumo em `ML`/VOLUME).

---

## Notas de execução

- **PostgreSQL:** provido pelo `docker-compose.yml` (Postgres 17 alpine) criado na Task 1; sobe com `docker compose up -d --wait`. As Tasks 2–6 (funções puras) não dependem do banco em runtime, mas importam tipos/enums do client gerado na Task 1.
- **Ordem obrigatória:** Task 1 sobe o banco, migra e gera o client Prisma; todas as demais importam dele. Não pular.
