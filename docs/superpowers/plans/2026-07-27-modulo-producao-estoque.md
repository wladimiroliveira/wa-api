# Módulo de Produção e Estoque — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir estoque de insumos (ledger `StockMovement` + saldo `currentStock`), registro de produção (consome insumos) e avaria (desperdício), sobre o núcleo de precificação já entregue.

**Architecture:** Um ledger único (`StockMovement`) é a fonte de verdade do saldo; `Supply.currentStock` é mantido na mesma transação de cada movimento via um helper `applyMovement`. Módulos `stock` (entrada + consulta), `waste` (avaria) e `production` (lotes) escrevem nesse ledger. A conta de consumo da produção é uma função pura testável.

**Tech Stack:** TypeScript (ESM, `nodenext`), Fastify 5, `fastify-type-provider-zod` + Zod 4, Prisma 6 + PostgreSQL, Vitest.

## Global Constraints

- **Fonte de verdade única:** toda mudança de estoque passa por `StockMovement` via `applyMovement`; `currentStock` é atualizado na MESMA transação (`increment: quantityBase`). Nada altera o saldo por fora do ledger.
- **`quantityBase` com sinal:** `+` entrada, `−` saída (produção/avaria), sempre na unidade base do insumo.
- **Unidades tipadas:** entrada/avaria recebem `quantity` + `unit` (enum `UnitOfMeasure`), validados na MESMA dimensão do `Supply.purchaseUnit` (reuso de `assertItemDimension`) e convertidos via `toBase`. Sem texto livre; sem conversão peso↔volume.
- **Quantidades em `Prisma.Decimal`:** nunca `number` do JS em aritmética. `number` só no boundary JSON, convertido no service/repository.
- **Idioma:** identificadores em inglês; mensagens de negócio e texto ao usuário em português.
- **ESM:** imports relativos com `.js`.
- **TDD** para funções puras; commits em Conventional Commits.
- **Base:** parte da branch `feat/producao-estoque` (núcleo já em `main`). Postgres via `docker compose up -d --wait`; `.env` tem `DATABASE_URL`.

---

### Task 1: Schema — estoque e produção (Prisma + migração)

**Files:**

- Modify: `prisma/schema.prisma`

**Interfaces:**

- Produces (client gerado em `src/generated/prisma`): enums `StockMovementType` (`ENTRY`,`PRODUCTION`,`WASTE`) e `WasteReason` (`SPOILED`,`DROPPED`,`EXPIRED`,`OTHER`); models `StockMovement`, `Production`; `Supply.currentStock: Decimal` e `Supply.movements`; `Recipe.productions`.

- [ ] **Step 1: Editar `prisma/schema.prisma`**

Adicionar os enums e models, e os campos novos em `Supply` e `Recipe`:

```prisma
enum StockMovementType {
  ENTRY
  PRODUCTION
  WASTE
}

enum WasteReason {
  SPOILED
  DROPPED
  EXPIRED
  OTHER
}
```

Em `model Supply`, adicionar:

```prisma
  currentStock Decimal        @default(0)
  movements    StockMovement[]
```

Em `model Recipe`, adicionar:

```prisma
  productions Production[]
```

Adicionar os dois models:

```prisma
model StockMovement {
  id           String            @id @default(uuid())
  supplyId     String
  supply       Supply            @relation(fields: [supplyId], references: [id], onDelete: Restrict)
  type         StockMovementType
  quantityBase Decimal
  reason       WasteReason?
  note         String?
  productionId String?
  production   Production?       @relation(fields: [productionId], references: [id], onDelete: Cascade)
  createdAt    DateTime          @default(now())
}

model Production {
  id            String          @id @default(uuid())
  recipeId      String
  recipe        Recipe          @relation(fields: [recipeId], references: [id], onDelete: Restrict)
  factor        Decimal
  producedUnits Decimal
  note          String?
  movements     StockMovement[]
  createdAt     DateTime        @default(now())
}
```

- [ ] **Step 2: Subir o Postgres (se necessário) e migrar**

Run: `docker compose up -d --wait && npm run db:migrate -- --name add_stock_and_production`
Expected: cria a migração, aplica no banco e regenera o client em `src/generated/prisma`.

- [ ] **Step 3: Verificar tipos e suíte existente**

Run: `npx tsc --noEmit && npm test`
Expected: `tsc` limpo; suíte existente segue verde (o campo `currentStock` default 0 não quebra nada).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: adiciona schema de estoque e producao"
```

---

### Task 2: Refactor — mover validação de dimensão para `shared/dimension.ts`

**Files:**

- Create: `src/modules/shared/dimension.ts`
- Delete: `src/modules/recipes/recipes.validation.ts`
- Modify: `src/modules/recipes/recipes.routes.ts` (import)
- Modify: `src/modules/pricing/pricing.calc.ts` (import)
- Modify: `src/modules/pricing/pricing.routes.ts` (import)
- Move: `tests/modules/recipes/recipes.validation.test.ts` → `tests/modules/shared/dimension.test.ts`

**Interfaces:**

- Produces: `src/modules/shared/dimension.ts` exportando `assertItemDimension(supplyUnit: UnitOfMeasure, usageUnit: UnitOfMeasure): void` e `class DimensionMismatchError extends Error` (com `code = "DIMENSION_MISMATCH"`) — mesmos comportamentos de hoje, reusados por recipes, pricing, stock, waste.

- [ ] **Step 1: Criar `src/modules/shared/dimension.ts`**

Mova o conteúdo atual de `recipes/recipes.validation.ts` para cá, ajustando o import de `unit-of-measure` (mesma pasta agora):

```ts
import { UnitOfMeasure } from "../../generated/prisma/index.js";
import { sameDimension } from "./unit-of-measure.js";

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

- [ ] **Step 2: Atualizar os imports dos consumidores**

- `src/modules/recipes/recipes.routes.ts`: trocar `from "./recipes.validation.js"` por `from "../shared/dimension.js"`.
- `src/modules/pricing/pricing.calc.ts`: trocar `from "../recipes/recipes.validation.js"` por `from "../shared/dimension.js"`.
- `src/modules/pricing/pricing.routes.ts`: trocar `from "../recipes/recipes.validation.js"` por `from "../shared/dimension.js"`.

- [ ] **Step 3: Remover o arquivo antigo e mover o teste**

```bash
git rm src/modules/recipes/recipes.validation.ts
git mv tests/modules/recipes/recipes.validation.test.ts tests/modules/shared/dimension.test.ts
```

No teste movido, ajustar o import para `from "../../../src/modules/shared/dimension.js"` (o import do enum Prisma permanece `../../../src/generated/prisma/index.js`).

- [ ] **Step 4: Verificar suíte e tipos**

Run: `npx tsc --noEmit && npm test`
Expected: `tsc` limpo; toda a suíte verde (comportamento idêntico, só mudou a localização).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move validacao de dimensao para shared/dimension"
```

---

### Task 3: Módulo `stock` — ledger, saldo e entrada

**Files:**

- Create: `src/modules/stock/stock.repository.ts`
- Create: `src/modules/stock/stock.schema.ts`
- Create: `src/modules/stock/stock.service.ts`
- Create: `src/modules/stock/stock.routes.ts`
- Modify: `src/routes.ts` (registrar)
- Test: `tests/modules/stock/stock.routes.test.ts`

**Interfaces:**

- Consumes: `assertItemDimension` de `shared/dimension.js`; `toBase` de `shared/unit-of-measure.js`; `getSupply` de `supplies/supplies.repository.js`; `prisma` de `lib/prisma.js`; `Prisma`, `StockMovementType`, `UnitOfMeasure`.
- Produces:
  - `applyMovement(tx: Prisma.TransactionClient, input: { supplyId: string; type: StockMovementType; quantityBase: Prisma.Decimal; reason?: WasteReason; note?: string; productionId?: string }): Promise<StockMovement>` — cria a movimentação e atualiza `currentStock` (`increment: quantityBase`). **Usado por waste e production.**
  - `listMovements(supplyId: string)` — movimentações do insumo, mais recentes primeiro.
  - `createStockEntry(supplyId, { quantity, unit, note? })` (service) — valida dimensão, converte, aplica `ENTRY` em transação. Retorna `{ movement, currentStock }`.
  - Rotas: `POST /supplies/:id/stock-entries`, `GET /supplies/:id/movements`.

- [ ] **Step 1: Criar `src/modules/stock/stock.repository.ts`**

```ts
import prisma from "../../lib/prisma.js";
import { Prisma, StockMovementType, WasteReason } from "../../generated/prisma/index.js";

export interface ApplyMovementInput {
  supplyId: string;
  type: StockMovementType;
  quantityBase: Prisma.Decimal; // com sinal: + entrada, - saída
  reason?: WasteReason;
  note?: string;
  productionId?: string;
}

// Cria a movimentação e mantém o saldo na MESMA transação (fonte de verdade única).
export async function applyMovement(tx: Prisma.TransactionClient, input: ApplyMovementInput) {
  const movement = await tx.stockMovement.create({
    data: {
      supplyId: input.supplyId,
      type: input.type,
      quantityBase: input.quantityBase,
      reason: input.reason,
      note: input.note,
      productionId: input.productionId,
    },
  });
  await tx.supply.update({
    where: { id: input.supplyId },
    data: { currentStock: { increment: input.quantityBase } },
  });
  return movement;
}

export function listMovements(supplyId: string) {
  return prisma.stockMovement.findMany({
    where: { supplyId },
    orderBy: { createdAt: "desc" },
  });
}
```

- [ ] **Step 2: Criar `src/modules/stock/stock.schema.ts`**

```ts
import { z } from "zod";
import { unitOfMeasureSchema } from "../supplies/supplies.schema.js";

export const createStockEntrySchema = z.object({
  quantity: z.number().positive(),
  unit: unitOfMeasureSchema,
  note: z.string().optional(),
});

export const supplyIdParamSchema = z.object({ id: z.string().uuid() });

export type CreateStockEntryInput = z.infer<typeof createStockEntrySchema>;
```

- [ ] **Step 3: Criar `src/modules/stock/stock.service.ts`**

```ts
import prisma from "../../lib/prisma.js";
import { Prisma, StockMovementType } from "../../generated/prisma/index.js";
import { getSupply } from "../supplies/supplies.repository.js";
import { assertItemDimension } from "../shared/dimension.js";
import { toBase } from "../shared/unit-of-measure.js";
import { applyMovement } from "./stock.repository.js";
import type { CreateStockEntryInput } from "./stock.schema.js";

export class SupplyNotFoundError extends Error {
  readonly code = "SUPPLY_NOT_FOUND";
  constructor() {
    super("Insumo não encontrado");
    this.name = "SupplyNotFoundError";
  }
}

export async function createStockEntry(supplyId: string, data: CreateStockEntryInput) {
  const supply = await getSupply(supplyId);
  if (!supply) throw new SupplyNotFoundError();
  assertItemDimension(supply.purchaseUnit, data.unit);

  const quantityBase = toBase(new Prisma.Decimal(data.quantity), data.unit);

  const movement = await prisma.$transaction((tx) =>
    applyMovement(tx, {
      supplyId,
      type: StockMovementType.ENTRY,
      quantityBase,
      note: data.note,
    }),
  );

  const updated = await getSupply(supplyId);
  return { movement, currentStock: updated?.currentStock };
}
```

- [ ] **Step 4: Criar `src/modules/stock/stock.routes.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { createStockEntrySchema, supplyIdParamSchema } from "./stock.schema.js";
import { createStockEntry, SupplyNotFoundError } from "./stock.service.js";
import { DimensionMismatchError } from "../shared/dimension.js";
import { listMovements } from "./stock.repository.js";

export default async function stockRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/supplies/:id/stock-entries",
    { schema: { params: supplyIdParamSchema, body: createStockEntrySchema } },
    async (req, reply) => {
      try {
        const result = await createStockEntry(req.params.id, req.body);
        return reply.status(201).send(result);
      } catch (err) {
        if (err instanceof SupplyNotFoundError) return reply.status(404).send({ message: err.message });
        if (err instanceof DimensionMismatchError)
          return reply.status(400).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  r.get("/supplies/:id/movements", { schema: { params: supplyIdParamSchema } }, async (req) =>
    listMovements(req.params.id),
  );
}
```

- [ ] **Step 5: Registrar em `src/routes.ts`**

Adicionar `import stockRoutes from "./modules/stock/stock.routes.js";` e `await app.register(stockRoutes);` junto dos demais registros existentes (mantendo os que já existem).

- [ ] **Step 6: Escrever o teste de integração `tests/modules/stock/stock.routes.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import prisma from "../../../src/lib/prisma.js";

describe("stock routes (integração)", () => {
  let app: FastifyInstance;
  let supplyId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/supplies",
      payload: {
        name: "Chocolate (estoque)",
        type: "INGREDIENT",
        purchaseUnit: "KG",
        purchaseQty: 1,
        purchasePrice: 12.0,
      },
    });
    supplyId = res.json().id;
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { supplyId } }).catch((e) => console.warn("cleanup movements:", e));
    await prisma.supply.delete({ where: { id: supplyId } }).catch((e) => console.warn("cleanup supply:", e));
    await app.close();
  });

  test("entrada incrementa o saldo e cria movimento ENTRY", async () => {
    const entry = await app.inject({
      method: "POST",
      url: `/supplies/${supplyId}/stock-entries`,
      payload: { quantity: 2, unit: "KG" }, // 2 KG = 2000 g
    });
    expect(entry.statusCode).toBe(201);
    expect(entry.json().currentStock).toBe("2000");

    const supply = await app.inject({ method: "GET", url: `/supplies/${supplyId}` });
    expect(supply.json().currentStock).toBe("2000");

    const movements = await app.inject({ method: "GET", url: `/supplies/${supplyId}/movements` });
    expect(movements.json()).toHaveLength(1);
    expect(movements.json()[0].type).toBe("ENTRY");
    expect(movements.json()[0].quantityBase).toBe("2000");
  });

  test("dimensão incompatível (insumo em KG, entrada em ML) → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/supplies/${supplyId}/stock-entries`,
      payload: { quantity: 100, unit: "ML" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("DIMENSION_MISMATCH");
  });
});
```

- [ ] **Step 7: Rodar tipos + teste**

Run: `docker compose up -d --wait && npx tsc --noEmit && npx vitest run tests/modules/stock/stock.routes.test.ts`
Expected: `tsc` limpo; teste do stock verde.

- [ ] **Step 8: Commit**

```bash
git add src/modules/stock src/routes.ts tests/modules/stock
git commit -m "feat: adiciona modulo stock com ledger, saldo e entrada"
```

---

### Task 4: Módulo `waste` — avaria/desperdício

**Files:**

- Create: `src/modules/waste/waste.schema.ts`
- Create: `src/modules/waste/waste.service.ts`
- Create: `src/modules/waste/waste.routes.ts`
- Modify: `src/routes.ts` (registrar)
- Test: `tests/modules/waste/waste.routes.test.ts`

**Interfaces:**

- Consumes: `applyMovement` de `stock/stock.repository.js`; `getSupply`; `assertItemDimension`, `DimensionMismatchError` de `shared/dimension.js`; `toBase`; `prisma`; `Prisma`, `StockMovementType`, `WasteReason`.
- Produces:
  - `createWaste(supplyId, { quantity, unit, reason, note? })` (service) — aplica `WASTE` com `quantityBase` **negativo** em transação.
  - `listWastes()` — todas as movimentações `WASTE` (com o insumo), mais recentes primeiro.
  - Rotas: `POST /supplies/:id/wastes`, `GET /wastes`.

- [ ] **Step 1: Criar `src/modules/waste/waste.schema.ts`**

```ts
import { z } from "zod";
import { unitOfMeasureSchema } from "../supplies/supplies.schema.js";

export const wasteReasonSchema = z.enum(["SPOILED", "DROPPED", "EXPIRED", "OTHER"]);

export const createWasteSchema = z.object({
  quantity: z.number().positive(),
  unit: unitOfMeasureSchema,
  reason: wasteReasonSchema,
  note: z.string().optional(),
});

export const supplyIdParamSchema = z.object({ id: z.string().uuid() });

export type CreateWasteInput = z.infer<typeof createWasteSchema>;
```

- [ ] **Step 2: Criar `src/modules/waste/waste.service.ts`**

```ts
import prisma from "../../lib/prisma.js";
import { Prisma, StockMovementType } from "../../generated/prisma/index.js";
import { getSupply } from "../supplies/supplies.repository.js";
import { assertItemDimension } from "../shared/dimension.js";
import { toBase } from "../shared/unit-of-measure.js";
import { applyMovement } from "../stock/stock.repository.js";
import { SupplyNotFoundError } from "../stock/stock.service.js";
import type { CreateWasteInput } from "./waste.schema.js";

export async function createWaste(supplyId: string, data: CreateWasteInput) {
  const supply = await getSupply(supplyId);
  if (!supply) throw new SupplyNotFoundError();
  assertItemDimension(supply.purchaseUnit, data.unit);

  const quantityBase = toBase(new Prisma.Decimal(data.quantity), data.unit).negated();

  const movement = await prisma.$transaction((tx) =>
    applyMovement(tx, {
      supplyId,
      type: StockMovementType.WASTE,
      quantityBase,
      reason: data.reason,
      note: data.note,
    }),
  );

  const updated = await getSupply(supplyId);
  return { movement, currentStock: updated?.currentStock };
}

export function listWastes() {
  return prisma.stockMovement.findMany({
    where: { type: StockMovementType.WASTE },
    include: { supply: true },
    orderBy: { createdAt: "desc" },
  });
}
```

- [ ] **Step 3: Criar `src/modules/waste/waste.routes.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { createWasteSchema, supplyIdParamSchema } from "./waste.schema.js";
import { createWaste, listWastes } from "./waste.service.js";
import { SupplyNotFoundError } from "../stock/stock.service.js";
import { DimensionMismatchError } from "../shared/dimension.js";

export default async function wasteRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/supplies/:id/wastes",
    { schema: { params: supplyIdParamSchema, body: createWasteSchema } },
    async (req, reply) => {
      try {
        const result = await createWaste(req.params.id, req.body);
        return reply.status(201).send(result);
      } catch (err) {
        if (err instanceof SupplyNotFoundError) return reply.status(404).send({ message: err.message });
        if (err instanceof DimensionMismatchError)
          return reply.status(400).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  r.get("/wastes", async () => listWastes());
}
```

- [ ] **Step 4: Registrar em `src/routes.ts`**

Adicionar `import wasteRoutes from "./modules/waste/waste.routes.js";` e `await app.register(wasteRoutes);` (mantendo os demais).

- [ ] **Step 5: Escrever `tests/modules/waste/waste.routes.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import prisma from "../../../src/lib/prisma.js";

describe("waste routes (integração)", () => {
  let app: FastifyInstance;
  let supplyId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/supplies",
      payload: { name: "Farinha (avaria)", type: "INGREDIENT", purchaseUnit: "KG", purchaseQty: 1, purchasePrice: 5.0 },
    });
    supplyId = res.json().id;
    await app.inject({
      method: "POST",
      url: `/supplies/${supplyId}/stock-entries`,
      payload: { quantity: 1, unit: "KG" },
    }); // 1000 g
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { supplyId } }).catch((e) => console.warn("cleanup movements:", e));
    await prisma.supply.delete({ where: { id: supplyId } }).catch((e) => console.warn("cleanup supply:", e));
    await app.close();
  });

  test("avaria decrementa o saldo e cria movimento WASTE", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/supplies/${supplyId}/wastes`,
      payload: { quantity: 200, unit: "G", reason: "SPOILED" }, // -200 g
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().currentStock).toBe("800"); // 1000 - 200

    const wastes = await app.inject({ method: "GET", url: "/wastes" });
    const mine = wastes.json().filter((w: { supplyId: string }) => w.supplyId === supplyId);
    expect(mine).toHaveLength(1);
    expect(mine[0].type).toBe("WASTE");
    expect(mine[0].reason).toBe("SPOILED");
    expect(mine[0].quantityBase).toBe("-200");
  });

  test("reason ausente → 400 (validação)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/supplies/${supplyId}/wastes`,
      payload: { quantity: 50, unit: "G" },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 6: Rodar tipos + teste**

Run: `docker compose up -d --wait && npx tsc --noEmit && npx vitest run tests/modules/waste/waste.routes.test.ts`
Expected: `tsc` limpo; teste do waste verde.

- [ ] **Step 7: Commit**

```bash
git add src/modules/waste src/routes.ts tests/modules/waste
git commit -m "feat: adiciona modulo waste (avaria) no ledger"
```

---

### Task 5: `production.calc` — consumo de produção (função pura)

**Files:**

- Create: `src/modules/production/production.calc.ts`
- Test: `tests/modules/production/production.calc.test.ts`

**Interfaces:**

- Consumes: `toBase` de `shared/unit-of-measure.js`; `Prisma`, `UnitOfMeasure`.
- Produces:
  - `interface RecipeForProduction { batchYield: Prisma.Decimal; items: { supplyId: string; usageQty: Prisma.Decimal; usageUnit: UnitOfMeasure }[] }`
  - `interface ProductionSpec { batches?: Prisma.Decimal; producedQty?: Prisma.Decimal }`
  - `interface ConsumptionResult { factor: Prisma.Decimal; producedUnits: Prisma.Decimal; consumptions: { supplyId: string; consumedBase: Prisma.Decimal }[] }`
  - `computeConsumption(recipe: RecipeForProduction, spec: ProductionSpec): ConsumptionResult`

- [ ] **Step 1: Escrever o teste que falha `tests/modules/production/production.calc.test.ts`**

```ts
import { describe, expect, test } from "vitest";
import { Prisma, UnitOfMeasure } from "../../../src/generated/prisma/index.js";
import { computeConsumption } from "../../../src/modules/production/production.calc.js";

// Receita: rende 100 un; consome 1 UN de um insumo A (custo irrelevante aqui) e 200 G de um insumo B, por lote.
const recipe = {
  batchYield: new Prisma.Decimal(100),
  items: [
    { supplyId: "A", usageQty: new Prisma.Decimal(1), usageUnit: UnitOfMeasure.UN },
    { supplyId: "B", usageQty: new Prisma.Decimal(200), usageUnit: UnitOfMeasure.G },
  ],
};

describe("computeConsumption", () => {
  test("por batches: 2 lotes → fator 2, 200 unidades, consumo escalado", () => {
    const r = computeConsumption(recipe, { batches: new Prisma.Decimal(2) });
    expect(r.factor.equals(2)).toBe(true);
    expect(r.producedUnits.equals(200)).toBe(true);
    expect(r.consumptions.find((c) => c.supplyId === "A")!.consumedBase.equals(2)).toBe(true); // 1 UN × 2
    expect(r.consumptions.find((c) => c.supplyId === "B")!.consumedBase.equals(400)).toBe(true); // 200 G × 2
  });

  test("por producedQty: 300 un de um lote que rende 100 → fator 3", () => {
    const r = computeConsumption(recipe, { producedQty: new Prisma.Decimal(300) });
    expect(r.factor.equals(3)).toBe(true);
    expect(r.producedUnits.equals(300)).toBe(true);
    expect(r.consumptions.find((c) => c.supplyId === "B")!.consumedBase.equals(600)).toBe(true); // 200 G × 3
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/modules/production/production.calc.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `src/modules/production/production.calc.ts`**

```ts
import { Prisma, UnitOfMeasure } from "../../generated/prisma/index.js";
import { toBase } from "../shared/unit-of-measure.js";

export interface RecipeForProduction {
  batchYield: Prisma.Decimal;
  items: { supplyId: string; usageQty: Prisma.Decimal; usageUnit: UnitOfMeasure }[];
}

export interface ProductionSpec {
  batches?: Prisma.Decimal;
  producedQty?: Prisma.Decimal;
}

export interface ConsumptionResult {
  factor: Prisma.Decimal;
  producedUnits: Prisma.Decimal;
  consumptions: { supplyId: string; consumedBase: Prisma.Decimal }[];
}

// Consumo proporcional ao rendimento. Assume que exatamente um de batches/producedQty foi informado (validado no schema).
export function computeConsumption(recipe: RecipeForProduction, spec: ProductionSpec): ConsumptionResult {
  const factor = spec.batches ?? spec.producedQty!.div(recipe.batchYield);
  const producedUnits = factor.mul(recipe.batchYield);
  const consumptions = recipe.items.map((item) => ({
    supplyId: item.supplyId,
    consumedBase: toBase(item.usageQty, item.usageUnit).mul(factor),
  }));
  return { factor, producedUnits, consumptions };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/modules/production/production.calc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/production/production.calc.ts tests/modules/production/production.calc.test.ts
git commit -m "feat: adiciona calculo puro de consumo de producao"
```

---

### Task 6: Módulo `production` — registrar lote (transação + warnings)

**Files:**

- Create: `src/modules/production/production.schema.ts`
- Create: `src/modules/production/production.repository.ts`
- Create: `src/modules/production/production.service.ts`
- Create: `src/modules/production/production.routes.ts`
- Modify: `src/routes.ts` (registrar)
- Test: `tests/modules/production/production.routes.test.ts`

**Interfaces:**

- Consumes: `computeConsumption` de `production.calc.js`; `getRecipeWithItems` de `recipes/recipes.repository.js`; `applyMovement` de `stock/stock.repository.js`; `prisma`; `Prisma`, `StockMovementType`.
- Produces:
  - `registerProduction({ recipeId, batches?, producedQty?, note? })` (service) → `{ production, consumptions, warnings }`; `warnings: { supplyId, resultingStock }[]` (insumos com saldo < 0 pós-produção).
  - `class RecipeNotFoundError` (code `RECIPE_NOT_FOUND`).
  - `listProductions()`, `getProduction(id)` (com movimentos).
  - Rotas: `POST /productions`, `GET /productions`, `GET /productions/:id`.

- [ ] **Step 1: Criar `src/modules/production/production.schema.ts`**

```ts
import { z } from "zod";

export const createProductionSchema = z
  .object({
    recipeId: z.string().uuid(),
    batches: z.number().positive().optional(),
    producedQty: z.number().positive().optional(),
    note: z.string().optional(),
  })
  .refine((d) => (d.batches === undefined) !== (d.producedQty === undefined), {
    message: "Informe exatamente um entre batches e producedQty",
  });

export const productionIdParamSchema = z.object({ id: z.string().uuid() });

export type CreateProductionInput = z.infer<typeof createProductionSchema>;
```

- [ ] **Step 2: Criar `src/modules/production/production.repository.ts`**

```ts
import prisma from "../../lib/prisma.js";

export function listProductions() {
  return prisma.production.findMany({ orderBy: { createdAt: "desc" } });
}

export function getProduction(id: string) {
  return prisma.production.findUnique({
    where: { id },
    include: { movements: true },
  });
}
```

- [ ] **Step 3: Criar `src/modules/production/production.service.ts`**

```ts
import prisma from "../../lib/prisma.js";
import { Prisma, StockMovementType } from "../../generated/prisma/index.js";
import { getRecipeWithItems } from "../recipes/recipes.repository.js";
import { applyMovement } from "../stock/stock.repository.js";
import { computeConsumption } from "./production.calc.js";
import type { CreateProductionInput } from "./production.schema.js";

export class RecipeNotFoundError extends Error {
  readonly code = "RECIPE_NOT_FOUND";
  constructor() {
    super("Receita não encontrada");
    this.name = "RecipeNotFoundError";
  }
}

export async function registerProduction(data: CreateProductionInput) {
  const recipe = await getRecipeWithItems(data.recipeId);
  if (!recipe) throw new RecipeNotFoundError();

  const spec = {
    batches: data.batches !== undefined ? new Prisma.Decimal(data.batches) : undefined,
    producedQty: data.producedQty !== undefined ? new Prisma.Decimal(data.producedQty) : undefined,
  };
  const { factor, producedUnits, consumptions } = computeConsumption(recipe, spec);

  const { production, warnings } = await prisma.$transaction(async (tx) => {
    const production = await tx.production.create({
      data: { recipeId: recipe.id, factor, producedUnits, note: data.note },
    });

    for (const c of consumptions) {
      await applyMovement(tx, {
        supplyId: c.supplyId,
        type: StockMovementType.PRODUCTION,
        quantityBase: c.consumedBase.negated(), // saída
        productionId: production.id,
      });
    }

    // Warnings: insumos cujo saldo resultante ficou negativo (regra "avisa, não bloqueia").
    const supplyIds = consumptions.map((c) => c.supplyId);
    const affected = await tx.supply.findMany({
      where: { id: { in: supplyIds } },
      select: { id: true, currentStock: true },
    });
    const warnings = affected
      .filter((s) => s.currentStock.lessThan(0))
      .map((s) => ({ supplyId: s.id, resultingStock: s.currentStock }));

    return { production, warnings };
  });

  return { production, consumptions, warnings };
}
```

- [ ] **Step 4: Criar `src/modules/production/production.routes.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { createProductionSchema, productionIdParamSchema } from "./production.schema.js";
import { registerProduction, RecipeNotFoundError } from "./production.service.js";
import { listProductions, getProduction } from "./production.repository.js";

export default async function productionRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post("/productions", { schema: { body: createProductionSchema } }, async (req, reply) => {
    try {
      const result = await registerProduction(req.body);
      return reply.status(201).send(result);
    } catch (err) {
      if (err instanceof RecipeNotFoundError) return reply.status(404).send({ code: err.code, message: err.message });
      throw err;
    }
  });

  r.get("/productions", async () => listProductions());

  r.get("/productions/:id", { schema: { params: productionIdParamSchema } }, async (req, reply) => {
    const production = await getProduction(req.params.id);
    if (!production) return reply.status(404).send({ message: "Produção não encontrada" });
    return production;
  });
}
```

- [ ] **Step 5: Registrar em `src/routes.ts`**

Adicionar `import productionRoutes from "./modules/production/production.routes.js";` e `await app.register(productionRoutes);` (mantendo os demais).

- [ ] **Step 6: Escrever `tests/modules/production/production.routes.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import prisma from "../../../src/lib/prisma.js";

describe("production routes (integração)", () => {
  let app: FastifyInstance;
  let supplyId: string;
  let recipeId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    // Insumo em UN, com 10 de saldo.
    supplyId = (
      await app.inject({
        method: "POST",
        url: "/supplies",
        payload: {
          name: "Massa (producao)",
          type: "INGREDIENT",
          purchaseUnit: "UN",
          purchaseQty: 1,
          purchasePrice: 45,
        },
      })
    ).json().id;
    await app.inject({
      method: "POST",
      url: `/supplies/${supplyId}/stock-entries`,
      payload: { quantity: 10, unit: "UN" },
    });
    // Receita: rende 100 un, consome 1 UN por lote.
    recipeId = (
      await app.inject({
        method: "POST",
        url: "/recipes",
        payload: {
          name: "Brigadeiro (producao)",
          batchYield: 100,
          laborCostPerHundred: 20,
          margin: 0.6,
          items: [{ supplyId, usageQty: 1, usageUnit: "UN" }],
        },
      })
    ).json().id;
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { supplyId } }).catch((e) => console.warn("cleanup movements:", e));
    await prisma.production.deleteMany({ where: { recipeId } }).catch((e) => console.warn("cleanup productions:", e));
    await prisma.recipeItem.deleteMany({ where: { recipeId } }).catch(() => {});
    await prisma.recipe.delete({ where: { id: recipeId } }).catch((e) => console.warn("cleanup recipe:", e));
    await prisma.supply.delete({ where: { id: supplyId } }).catch((e) => console.warn("cleanup supply:", e));
    await app.close();
  });

  test("produção por producedQty consome e baixa o saldo, sem warnings", async () => {
    // producedQty 300 → fator 3 → consome 3 UN. Saldo 10 → 7.
    const res = await app.inject({
      method: "POST",
      url: "/productions",
      payload: { recipeId, producedQty: 300 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.production.producedUnits).toBe("300");
    expect(body.consumptions.find((c: { supplyId: string }) => c.supplyId === supplyId).consumedBase).toBe("3");
    expect(body.warnings).toHaveLength(0);

    const supply = await app.inject({ method: "GET", url: `/supplies/${supplyId}` });
    expect(supply.json().currentStock).toBe("7");
  });

  test("produção além do saldo registra e retorna warning de saldo negativo", async () => {
    // Saldo atual 7. producedQty 1000 → fator 10 → consome 10 UN → saldo -3.
    const res = await app.inject({
      method: "POST",
      url: "/productions",
      payload: { recipeId, producedQty: 1000 },
    });
    expect(res.statusCode).toBe(201);
    const warning = res.json().warnings.find((w: { supplyId: string }) => w.supplyId === supplyId);
    expect(warning).toBeDefined();
    expect(warning.resultingStock).toBe("-3");
  });

  test("receita inexistente → 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/productions",
      payload: { recipeId: "00000000-0000-0000-0000-000000000000", batches: 1 },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 7: Rodar tipos + suíte completa**

Run: `docker compose up -d --wait && npx tsc --noEmit && npm test`
Expected: `tsc` limpo; toda a suíte verde (incluindo os novos testes de stock/waste/production).

- [ ] **Step 8: Commit**

```bash
git add src/modules/production src/routes.ts tests/modules/production/production.routes.test.ts
git commit -m "feat: adiciona registro de producao com consumo e warnings"
```

---

### Task 7: Verificação manual ponta a ponta (smoke)

**Files:** nenhum (validação manual da API rodando).

- [ ] **Step 1: Subir DB + API**

Run: `docker compose up -d --wait && npm run dev`
Expected: "Server is running".

- [ ] **Step 2: Criar insumo e dar entrada**

```bash
SID=$(curl -s -X POST http://localhost:3333/supplies -H "Content-Type: application/json" \
  -d '{"name":"Leite condensado","type":"INGREDIENT","purchaseUnit":"UN","purchaseQty":1,"purchasePrice":4.5}' | sed -E 's/.*"id":"([^"]+)".*/\1/')
curl -s -X POST http://localhost:3333/supplies/$SID/stock-entries -H "Content-Type: application/json" -d '{"quantity":20,"unit":"UN"}'
```

Expected: entrada com `currentStock: "20"`.

- [ ] **Step 3: Registrar avaria e conferir saldo**

```bash
curl -s -X POST http://localhost:3333/supplies/$SID/wastes -H "Content-Type: application/json" -d '{"quantity":2,"unit":"UN","reason":"EXPIRED"}'
curl -s http://localhost:3333/supplies/$SID/movements
```

Expected: saldo `18`; ledger com `ENTRY` (+20) e `WASTE` (-2).

- [ ] **Step 4: Criar receita e registrar produção**

```bash
RID=$(curl -s -X POST http://localhost:3333/recipes -H "Content-Type: application/json" \
  -d "{\"name\":\"Brigadeiro\",\"batchYield\":100,\"laborCostPerHundred\":20,\"margin\":0.6,\"items\":[{\"supplyId\":\"$SID\",\"usageQty\":1,\"usageUnit\":\"UN\"}]}" | sed -E 's/.*"id":"([^"]+)".*/\1/')
curl -s -X POST http://localhost:3333/productions -H "Content-Type: application/json" -d "{\"recipeId\":\"$RID\",\"producedQty\":500}"
```

Expected: `producedUnits: "500"`, consumo de 5 UN, `warnings: []`; saldo do insumo cai para 13.

- [ ] **Step 5: Produção acima do saldo → warning**

```bash
curl -s -X POST http://localhost:3333/productions -H "Content-Type: application/json" -d "{\"recipeId\":\"$RID\",\"producedQty\":5000}"
```

Expected: 201 com `warnings` listando o insumo com `resultingStock` negativo.

---

## Notas de execução

- **Pré-requisito:** Postgres via `docker compose up -d --wait`. Tasks 1, 3, 4, 6 e 7 tocam o banco; a Task 5 (pura) não.
- **Ordem obrigatória:** Task 1 (schema/migração/client) → Task 2 (refactor) → Task 3 (stock, dá o `applyMovement`) → Tasks 4 e 6 dependem do `applyMovement`; Task 5 (calc) antes da 6.
