# Design — Módulo de Produção e Estoque (wa-system)

- **Data:** 2026-07-27
- **Status:** Aprovado no brainstorming, aguardando revisão da spec
- **Escopo:** estoque de insumos (ledger + saldo), registro de produção (consome insumos) e avaria (desperdício). Segue e depende do núcleo já entregue (Insumos, Receitas, Precificação).

> **Convenção de idioma:** identificadores de código em **inglês**; documentação e texto visível ao usuário final em **português**.

---

## 1. Contexto e objetivo

O núcleo de custo/precificação está pronto, mas `Supply` só guarda dados de compra/custo — **não tem saldo de estoque**. Este módulo introduz o estoque de insumos e o registro de produção, atacando a segunda dor levantada pela empresa: _"perco insumo/desperdício, não sei o que tenho em estoque"_.

Objetivo central (decisão de brainstorming): **controle de estoque de insumos + registro de produção juntos** — um alimenta o outro. Planejamento de produção (a partir de demanda) fica para o módulo **Pedidos**.

**Sucesso:** saber o saldo atual de cada insumo, com histórico auditável de como chegou nele (entradas, consumo de produção, avarias); registrar lotes produzidos que baixam os insumos automaticamente; e medir desperdício.

---

## 2. Princípios

- **Fonte de verdade única do saldo:** toda mudança de estoque — entrada, consumo de produção, avaria — passa pelo **mesmo ledger** (`StockMovement`). `currentStock` é mantido na mesma transação e sempre igual à soma das movimentações do insumo. Nenhum caminho altera o saldo por fora do ledger.
- **Unidades tipadas (reuso do núcleo):** quantidades de estoque vivem na **unidade base** do insumo (grama/ml/unidade). Entradas e avarias informam `quantity` + `unit` (enum `UnitOfMeasure`), validados na **mesma dimensão** do insumo e convertidos para a base via `toBase`. Sem texto livre, sem conversão peso↔volume.
- **Dinheiro/quantidades em `Prisma.Decimal`:** nunca `number` do JS em aritmética. (Este módulo lida com quantidades, não preços; mesma disciplina.)
- **Estoque e custo desacoplados:** entrada de estoque **não** altera o `purchasePrice`/custo do insumo (decisão de brainstorming). O custo continua editável à parte, e a precificação não é afetada.

---

## 3. Modelo de domínio

### 3.1 Alteração em `Supply`

| Campo novo     | Tipo                  | Obs                                                               |
| -------------- | --------------------- | ----------------------------------------------------------------- |
| `currentStock` | `Decimal` (default 0) | saldo atual na unidade base; = Σ `quantityBase` das movimentações |
| `movements`    | `StockMovement[]`     | relação                                                           |

### 3.2 `StockMovement` (o ledger)

| Campo          | Tipo                                                     | Obs                                         |
| -------------- | -------------------------------------------------------- | ------------------------------------------- |
| `supplyId`     | ref → `Supply`                                           |                                             |
| `type`         | `StockMovementType` = `ENTRY` \| `PRODUCTION` \| `WASTE` |                                             |
| `quantityBase` | `Decimal` (com sinal)                                    | **+** entrada, **−** saída, na unidade base |
| `reason`       | `WasteReason?`                                           | preenchido apenas em `WASTE`                |
| `note`         | `String?`                                                | observação livre opcional                   |
| `productionId` | `String?` → `Production`                                 | preenchido apenas em `PRODUCTION`           |
| `createdAt`    | `DateTime`                                               |                                             |

`currentStock` = Σ `quantityBase` do insumo. O ledger é a autoridade; o saldo é uma cópia mantida transacionalmente.

### 3.3 `Production` (lote produzido)

| Campo           | Tipo              | Ex.                                                                            |
| --------------- | ----------------- | ------------------------------------------------------------------------------ |
| `recipeId`      | ref → `Recipe`    |                                                                                |
| `factor`        | `Decimal`         | multiplicador da receita aplicado (ex.: 3)                                     |
| `producedUnits` | `Decimal`         | `factor × batchYield` (ex.: 300) — redundância proposital p/ histórico legível |
| `note`          | `String?`         |                                                                                |
| `movements`     | `StockMovement[]` | as saídas de consumo (`type = PRODUCTION`)                                     |
| `createdAt`     | `DateTime`        |                                                                                |

### 3.4 Enums

- `StockMovementType`: `ENTRY`, `PRODUCTION`, `WASTE`.
- `WasteReason`: `SPOILED` (estragou), `DROPPED` (caiu), `EXPIRED` (venceu), `OTHER`.

---

## 4. Operações e regras

### 4.1 Entrada de estoque (compra/reposição)

`POST /supplies/:id/stock-entries` — body `{ quantity, unit, note? }`.

- `quantity > 0`; `unit` (enum) na **mesma dimensão** do insumo → convertido para base via `toBase`.
- Numa transação: `applyMovement(ENTRY, +quantityBase)` — cria a movimentação e incrementa `currentStock`.
- Resposta: a movimentação criada + o novo saldo.

### 4.2 Avaria / desperdício (módulo próprio)

`POST /supplies/:id/wastes` — body `{ quantity, unit, reason, note? }`.

- `quantity > 0`; `unit` mesma dimensão do insumo; `reason` (enum `WasteReason`) **obrigatório**.
- Numa transação: `applyMovement(WASTE, −quantityBase)` — grava o `WASTE` no ledger compartilhado e decrementa o saldo.
- `GET /wastes` — relatório de desperdício (lista de avarias; filtrável por insumo/período fica como evolução — ver §8).

### 4.3 Registrar produção

`POST /productions` — body `{ recipeId, batches? | producedQty?, note? }` (exatamente **um** entre `batches` e `producedQty`, `> 0`).

- **Fator:** `factor = batches ?? (producedQty ÷ recipe.batchYield)`; `producedUnits = factor × batchYield`.
- **Consumo por insumo:** `consumedBase = toBase(item.usageQty, item.usageUnit) × factor` (função pura `computeConsumption`).
- Numa transação: cria o `Production`; para cada item, `applyMovement(PRODUCTION, −consumedBase, productionId)` (decrementa cada saldo).
- **Regra "avisa, não bloqueia":** ao final, monta a lista de insumos cujo saldo resultante ficou **< 0** e devolve como `warnings`. A produção é registrada mesmo assim.
- Resposta: `{ production, consumptions: [{ supplyId, consumedBase }], warnings: [{ supplyId, resultingStock }] }`.
- Receita inexistente → 404 (via handler global P2025).

### 4.4 Consulta

- `GET /supplies/:id/movements` — histórico do ledger do insumo (mais recentes primeiro).
- `GET /productions` e `GET /productions/:id` — lotes e a quebra de consumo.
- `GET /supplies` e `GET /supplies/:id` passam a exibir `currentStock`.

---

## 5. Arquitetura técnica

Segue o padrão do núcleo (`routes → service → repository`, Fastify + Zod + Prisma).

```
src/modules/
  shared/
    dimension.ts     // MOVIDO de recipes/recipes.validation.ts:
                     //   assertItemDimension + DimensionMismatchError
                     //   agora reusado por recipes, pricing, stock, production, waste
  stock/
    stock.repository.ts   // applyMovement(tx, {...}), listMovements
    stock.service.ts      // entrada (ENTRY) em transação
    stock.schema.ts       // Zod
    stock.routes.ts       // POST /supplies/:id/stock-entries, GET /supplies/:id/movements
  production/
    production.calc.ts    // computeConsumption (PURO)
    production.repository.ts
    production.service.ts // registra produção em transação + monta warnings
    production.schema.ts
    production.routes.ts
  waste/
    waste.service.ts
    waste.schema.ts
    waste.routes.ts       // POST /supplies/:id/wastes, GET /wastes
```

### 5.1 Refactor de reuso

`assertItemDimension` + `DimensionMismatchError` saem de `recipes/recipes.validation.ts` para `shared/dimension.ts`. `recipes` e `pricing` passam a importar de `shared/dimension.js`. É o único refactor, justificado pelo reuso por stock/waste.

### 5.2 Coração transacional — `applyMovement`

```
applyMovement(tx, { supplyId, type, quantityBase, reason?, note?, productionId? }):
  - tx.stockMovement.create({ ... })
  - tx.supply.update({ where:{id:supplyId}, data:{ currentStock: { increment: quantityBase } } })
```

Reusado por entrada (1×), avaria (1×) e produção (N×), sempre dentro de uma transação fornecida pelo service. Isso garante a fonte de verdade única do saldo.

### 5.3 Esboço do schema Prisma

```prisma
enum StockMovementType { ENTRY PRODUCTION WASTE }
enum WasteReason { SPOILED DROPPED EXPIRED OTHER }

model Supply {
  // ... campos existentes ...
  currentStock Decimal        @default(0)
  movements    StockMovement[]
}

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

`Recipe` ganha `productions Production[]`. `onDelete: Restrict` em `StockMovement.supplyId` (não apagar insumo com histórico) e em `Production.recipeId`.

---

## 6. Validação

1. **Dimensão rígida:** `unit` de entrada/avaria deve ter a mesma dimensão do `Supply.purchaseUnit` (reuso de `assertItemDimension`); incompatível → 400. Produção reusa a validação já existente dos itens da receita (garantida na criação da receita).
2. **Quantidades:** `quantity` (entrada/avaria) e `batches`/`producedQty` (produção) `> 0`.
3. **Produção:** exatamente um entre `batches` e `producedQty`. Receita inexistente → 404.
4. **Avaria:** `reason` (enum) obrigatório.
5. **Exclusão de insumo:** `onDelete: Restrict` já impede apagar insumo com movimentações.

---

## 7. Estratégia de testes

- **Unit (o valor):** `computeConsumption` — fator via `batches`, fator via `producedQty`, escala do consumo por item, `producedUnits`. Casos com múltiplos itens.
- **Integração (via `buildApp` + `app.inject`, com Postgres):**
  - Entrada incrementa `currentStock` e cria movimento `ENTRY`; `GET /movements` lista.
  - Avaria decrementa saldo, cria `WASTE`, valida `reason` obrigatório; dimensão incompatível → 400.
  - Produção: cria `Production` + N movimentos `PRODUCTION`, saldos decrementados corretos, `producedUnits` correto (tanto por `batches` quanto por `producedQty`).
  - **Produção com saldo insuficiente:** registra mesmo assim e retorna `warnings` com os saldos negativos (regra §4.3).
  - `GET /supplies/:id` exibe `currentStock`.

---

## 8. Não-objetivos e decisões adiadas

- **Acerto de inventário** (`ADJUSTMENT`) — adiado até surgir divergência de contagem real.
- **Estoque de produto acabado** — a produção só consome insumos e registra o lote; saldo de produtos prontos entra com **Pedidos**.
- **Custo médio ponderado / atualização de custo pela compra** — entrada não mexe no custo; fica para evolução futura.
- **Planejamento de produção a partir de demanda** — pertence a **Pedidos**.
- **Estoque mínimo / alerta preventivo** — `warnings` só cobrem saldo negativo pós-produção; alerta de mínimo é evolução futura.
- **Filtros de relatório de avaria** (por período/insumo) — `GET /wastes` começa como lista simples; filtros são evolução.

---

## 9. Glossário

- **Ledger (`StockMovement`):** livro de movimentações; fonte de verdade do saldo.
- **`currentStock`:** saldo do insumo na unidade base, mantido = Σ movimentações.
- **Entrada (`ENTRY`):** reposição/compra que aumenta o estoque.
- **Consumo (`PRODUCTION`):** saída gerada ao registrar um lote de produção.
- **Avaria (`WASTE`):** perda/desperdício (estragou, caiu, venceu) — saída com motivo.
- **`factor` / `producedUnits`:** multiplicador da receita aplicado e unidades resultantes (`factor × batchYield`).
