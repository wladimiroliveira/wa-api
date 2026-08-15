# Design — Núcleo de Custo e Precificação (wa-system)

- **Data:** 2026-07-26
- **Status:** Aprovado no brainstorming, aguardando revisão da spec
- **Escopo deste documento:** módulo vertical e implementável de **Insumos + Fichas Técnicas + Precificação** (`Supply` + `Recipe` + Pricing). Produção e Pedidos entram apenas como esboço de escopo (viram specs próprias depois).

> **Convenção de idioma do projeto:** tudo que **não** toca o usuário final é escrito em **inglês** — models, fields, enums, endpoints, pastas de módulo, variáveis. Apenas a **documentação** (specs, comentários explicativos de negócio) fica em português. Por isso este documento usa termos de domínio em PT no texto, mas nomes de código em EN.

---

## 1. Contexto e objetivo

Mini-ERP para uma pequena empresa de produção e distribuição de doces e salgados para festas. A dor principal levantada é **precificação no chute**: a empresa não sabe o custo real de produção e, por consequência, não sabe cobrar com margem consciente.

Este documento resolve essa dor construindo a cadeia mínima que produz um preço confiável:

```
Supply ──► Recipe ──► custo por cento ──► preço (markup)
(matéria-prima) (receita)   (a conta)         (a venda)
```

**Objetivo de sucesso:** dado um cadastro de insumos (`Supply`) e uma ficha técnica (`Recipe`), o sistema calcula automaticamente o custo por cento e sugere um preço de venda (cento e meio-cento), sem cálculo manual e sem campos de texto livre que abram margem a erro.

---

## 2. Unidade de venda e modelo de custo

- **Unidade de venda:** por **cento** (100 unidades), com **meio-cento** (50 unidades).
- **Composição do custo (camada 2):** `ingredientes + embalagem + mão de obra`.
  - Ingredientes e embalagem: derivados dos insumos consumidos na ficha técnica.
  - Mão de obra: **valor fixo arbitrado por cento** (a empresa não cronometra).
- **Fora de escopo do custo agora:** custos indiretos rateados (gás, energia, aluguel), impostos e frete/entrega. Ver §10.

---

## 3. Princípios de modelagem

### 3.1 Unidades tipadas (sem texto livre)

Decisão arquitetural central: **nenhuma unidade de medida é texto livre**. Todo campo de unidade é um enum que carrega a própria conversão, eliminando a classe de erro "stringly-typed" (`"kg"`, `"Kg"`, `"quilo"`…) e a digitação manual de fatores de conversão.

#### Enum `UnitOfMeasure` (tabela estática, em código — não é dado do usuário)

| Valor | `dimension` | `factorToBase` (→ base canônica) |
| ----- | ----------- | -------------------------------- |
| `G`   | `WEIGHT`    | 1                                |
| `KG`  | `WEIGHT`    | 1000                             |
| `ML`  | `VOLUME`    | 1                                |
| `L`   | `VOLUME`    | 1000                             |
| `UN`  | `COUNT`     | 1                                |

Bases canônicas: `WEIGHT` → grama, `VOLUME` → mililitro, `COUNT` → unidade. O sistema **conhece** que `KG → G` é ×1000; o usuário nunca digita esse fator.

#### Regra de dimensão (rígida)

Um item de receita só pode consumir um insumo em **unidade da mesma `dimension`** do insumo. Ex.: um insumo comprado em `KG` (`WEIGHT`) só aceita consumo em `G` ou `KG`, nunca em `ML`. Conversão peso↔volume por densidade é **explicitamente proibida** nesta versão (ver §10 — fica para uma feature estruturada futura).

### 3.2 Dinheiro com precisão exata (`Decimal`)

Todo valor monetário é armazenado como **`Decimal` (`NUMERIC` no Postgres)** — aritmética exata de precisão arbitrária, **não** `float`. Vantagens: o valor é lido de forma natural no banco (`104.00`, não `10400`), sem conversão para apresentar em outras interfaces.

**Disciplina obrigatória:** aritmética monetária no código TS usa o tipo `Decimal` do Prisma (decimal.js), **nunca** coagir para o `number` nativo do JS (esse sim é float e acumula erro). Custos derivados fracionários (ex.: R$ 0,012/g) também são calculados com `Decimal`.

---

## 4. Modelo de domínio

### 4.1 `Supply` (insumo)

Matéria-prima ou embalagem. Onde nasce o custo.

| Campo           | Tipo            | Ex.                         | Observação                                               |
| --------------- | --------------- | --------------------------- | -------------------------------------------------------- |
| `name`          | string          | "Chocolate em pó"           |                                                          |
| `type`          | `SupplyType`    | `INGREDIENT` \| `PACKAGING` | embalagem tratada como insumo, só marcada diferente      |
| `purchaseUnit`  | `UnitOfMeasure` | `KG`                        | enum — sem texto livre                                   |
| `purchaseQty`   | Decimal         | `1`                         | quantas dessas unidades você compra pelo `purchasePrice` |
| `purchasePrice` | Decimal         | `12.00`                     | preço pago pela compra acima                             |

**Custo derivado (não persistido):**

```
costPerBase = purchasePrice ÷ (purchaseQty × purchaseUnit.factorToBase)
```

Ex. chocolate: `12.00 ÷ (1 × 1000)` = **R$ 0,012/g**.

### 4.2 `Recipe` (ficha técnica)

A receita/produto vendável.

| Campo                 | Tipo           | Ex.                      | Observação                                   |
| --------------------- | -------------- | ------------------------ | -------------------------------------------- |
| `name`                | string         | "Brigadeiro tradicional" |                                              |
| `batchYield`          | Decimal        | `100`                    | unidades produzidas no lote                  |
| `laborCostPerHundred` | Decimal        | `20.00`                  | valor fixo arbitrado (mão de obra por cento) |
| `margin`              | Decimal        | `0.60`                   | **obrigatório** — markup por produto         |
| `items`               | `RecipeItem[]` |                          | ingredientes **e** embalagens                |

### 4.3 `RecipeItem`

Consumo de um insumo dentro de uma receita.

| Campo       | Tipo            | Ex.   | Observação                                |
| ----------- | --------------- | ----- | ----------------------------------------- |
| `supplyId`  | ref             |       |                                           |
| `usageQty`  | Decimal         | `200` |                                           |
| `usageUnit` | `UnitOfMeasure` | `G`   | **validado:** mesma `dimension` do insumo |

**Custo do item (derivado):**

```
itemCost = usageQty × usageUnit.factorToBase × supply.costPerBase
```

Ex.: `200 × 1 × 0,012` = **R$ 2,40**.

> **Margem por produto:** não há margem global. Cada `Recipe` possui sua própria `margin` obrigatória, permitindo precificação flexível por produto. A tela de margem por produto mapeia para `PATCH /recipes/:id/margin`.

---

## 5. Cálculo — do custo ao preço

### 5.1 Custo

```
suppliesCostPerBatch  = Σ itemCost                        (todos os itens da receita)
suppliesCostPerHundred = suppliesCostPerBatch ÷ (batchYield ÷ 100)
totalCostPerHundred   = suppliesCostPerHundred + laborCostPerHundred
```

### 5.2 Preço (markup)

```
exactPrice          = totalCostPerHundred × (1 + margin)
pricePerHundred     = roundUpToNearest(exactPrice, R$1,00)
pricePerHalfHundred = roundUpToNearest(pricePerHundred ÷ 2, R$1,00)
```

O sistema expõe **tanto o `exactPrice` quanto o `pricePerHundred` arredondado** (transparência).

### 5.3 Exemplo ponta a ponta (cento de brigadeiro)

- Insumos no lote de 100 un: R$ 45,00
- `suppliesCostPerHundred` = 45 ÷ (100÷100) = R$ 45,00
- - MO R$ 20,00 → `totalCostPerHundred` = **R$ 65,00**
- margem 60% (markup): `exactPrice` = 65 × 1,60 = R$ 104,00 → `pricePerHundred` = **R$ 104,00**
- `pricePerHalfHundred` = roundUp(52,00) = **R$ 52,00**

---

## 6. Regras de validação

1. **Dimensão rígida:** `RecipeItem.usageUnit` deve ter a mesma `dimension` de `Supply.purchaseUnit`. Rejeitar no service (o Zod da rota não conhece o insumo referenciado; a checagem exige buscar o `Supply`).
2. **Dinheiro:** valores monetários `Decimal` ≥ 0.
3. **Quantidades:** `purchaseQty`, `usageQty`, `batchYield` > 0.
4. **Margem:** `Decimal` ≥ 0 (0.60 = 60%), obrigatória.
5. **Exclusão de insumo:** impedir (ou avisar) exclusão de `Supply` referenciado por algum `RecipeItem` (`onDelete: Restrict`).

---

## 7. Arquitetura técnica

- **Stack existente:** Fastify 5 + `fastify-type-provider-zod` + Zod 4 + Swagger (já configurado em `src/server.ts`).
- **Persistência:** **Prisma + PostgreSQL** (o `tsconfig` já aponta `src/generated`, saída padrão do Prisma).
- **Estrutura em módulos** (padrão consistente por módulo, nomes em inglês):
  ```
  src/modules/
    supplies/     { routes, service, schema (zod), repository }
    recipes/      { routes, service, schema, repository }
    pricing/      { routes, service, schema }   // orquestra o cálculo; sem tabela própria
    shared/
      unit-of-measure.ts   // enum + tabela factorToBase/dimension + helpers de conversão e validação de dimensão
      money.ts             // helpers de Decimal e roundUpToNearest
  ```
- **Camadas por módulo:** `routes` (HTTP + Zod) → `service` (regras/cálculo) → `repository` (Prisma). O cálculo de custo/preço vive no `service` de `pricing`, consumindo dados via repositories de `supplies`/`recipes`.
- `src/routes.ts` registra os routers de cada módulo.

### 7.1 Esboço do schema Prisma

```prisma
enum SupplyType { INGREDIENT PACKAGING }
enum UnitOfMeasure { G KG ML L UN }

model Supply {
  id            String   @id @default(uuid())
  name          String
  type          SupplyType
  purchaseUnit  UnitOfMeasure
  purchaseQty   Decimal
  purchasePrice Decimal
  recipeItems   RecipeItem[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model Recipe {
  id                  String   @id @default(uuid())
  name                String
  batchYield          Decimal
  laborCostPerHundred Decimal
  margin              Decimal
  items               RecipeItem[]
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}

model RecipeItem {
  id        String   @id @default(uuid())
  recipeId  String
  recipe    Recipe   @relation(fields: [recipeId], references: [id], onDelete: Cascade)
  supplyId  String
  supply    Supply   @relation(fields: [supplyId], references: [id], onDelete: Restrict)
  usageQty  Decimal
  usageUnit UnitOfMeasure
}
```

### 7.2 Endpoints (REST)

| Método           | Rota                   | Descrição                                                                    |
| ---------------- | ---------------------- | ---------------------------------------------------------------------------- |
| POST/GET         | `/supplies`            | criar / listar                                                               |
| GET/PATCH/DELETE | `/supplies/:id`        | detalhe / editar / excluir (com trava §6.5)                                  |
| POST/GET         | `/recipes`             | criar / listar                                                               |
| GET/PATCH/DELETE | `/recipes/:id`         | detalhe (inclui itens) / editar / excluir                                    |
| GET              | `/recipes/:id/pricing` | **saída-chave:** custo detalhado + `pricePerHundred` + `pricePerHalfHundred` |
| PATCH            | `/recipes/:id/margin`  | atualizar margem do produto (tela de margem por produto)                     |

---

## 8. Estratégia de testes

- **Unitários (núcleo do valor):** helpers de `unit-of-measure` (conversão, `factorToBase`, validação de `dimension`) e `money` (`Decimal`, `roundUpToNearest` em múltiplo de R$1). Casos: chocolate em kg→g, leite condensado em un, forminha em pacote (`purchaseQty`=100).
- **Unitários de cálculo:** `costPerBase`, `itemCost`, `totalCostPerHundred`, markup, meio-cento — validando o exemplo da §5.3.
- **Validação:** rejeição de dimensão incompatível (peso × volume); dinheiro/quantidade inválidos.
- **Integração (rota-chave):** `GET /recipes/:id/pricing` retorna a quebra de custo e os preços corretos ponta a ponta.

---

## 9. Esboço de escopo — módulos futuros (specs próprias)

Não implementados agora; registrados para ancorar o domínio.

- **Produção (`Production`):** planeja e registra lotes produzidos a partir de receitas; **consome insumos** (baixa de estoque) conforme o `batchYield`. Conecta-se a `Supply` (estoque) e `Recipe` (receita). Introduz o conceito de estoque/saldo de insumo, hoje ausente.
- **Pedidos (`Order`):** pedidos de festa com data de entrega, itens (receitas em cento/meio-cento) e preço vindo da Precificação. Dispara demanda de Produção (o que produzir para quando). Conecta-se a Pricing (preço) e Production (planejamento).

Dependência natural: `Supply → Recipe/Pricing (esta spec) → Production → Order`.

---

## 10. Não-objetivos e decisões adiadas

- **Conversão peso↔volume por densidade** — proibida agora; feature estruturada futura.
- **Custos indiretos rateados** (gás, energia, aluguel — "camada 3").
- **Impostos e frete/entrega** no preço ("camada 4").
- **Margem global / valor sugerido** — descartado; margem é sempre por produto.
- **Controle de estoque/saldo de insumos** — chega com o módulo de Produção.
- **Autenticação/usuários** — o Swagger já prevê `BearerAuth`, mas auth não faz parte desta spec.

---

## 11. Glossário

- **Cento / meio-cento:** 100 / 50 unidades — a forma de venda (`perHundred` / `perHalfHundred`).
- **Supply (insumo):** matéria-prima ou embalagem consumida na produção.
- **Recipe (ficha técnica):** receita de um produto vendável (itens + rendimento + mão de obra + margem).
- **batchYield (rendimento):** quantas unidades um lote da receita produz.
- **Markup:** preço = custo × (1 + margem).
- **dimension:** grandeza física da unidade (`WEIGHT`, `VOLUME`, `COUNT`); base da validação rígida.
