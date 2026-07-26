# Design — Núcleo de Custo e Precificação (wa-system)

- **Data:** 2026-07-26
- **Status:** Aprovado no brainstorming, aguardando revisão da spec
- **Escopo deste documento:** módulo vertical e implementável de **Insumos + Fichas Técnicas + Precificação**. Produção e Pedidos entram apenas como esboço de escopo (viram specs próprias depois).

---

## 1. Contexto e objetivo

Mini-ERP para uma pequena empresa de produção e distribuição de doces e salgados para festas. A dor principal levantada é **precificação no chute**: a empresa não sabe o custo real de produção e, por consequência, não sabe cobrar com margem consciente.

Este documento resolve essa dor construindo a cadeia mínima que produz um preço confiável:

```
Insumos ──► Fichas Técnicas ──► Custo por cento ──► Preço (markup)
(matéria-prima)   (receita)        (a conta)          (a venda)
```

**Objetivo de sucesso:** dado um cadastro de insumos e uma ficha técnica, o sistema calcula automaticamente o custo por cento e sugere um preço de venda (cento e meio-cento), sem cálculo manual e sem campos de texto livre que abram margem a erro.

---

## 2. Unidade de venda e modelo de custo

- **Unidade de venda:** por **cento** (100 unidades), com **meio-cento** (50 unidades).
- **Composição do custo (camada 2):** `ingredientes + embalagem + mão de obra`.
  - Ingredientes e embalagem: derivados dos insumos consumidos na ficha técnica.
  - Mão de obra: **valor fixo arbitrado por cento** (a empresa não cronometra).
- **Fora de escopo do custo agora:** custos indiretos rateados (gás, energia, aluguel), impostos e frete/entrega. Ver §10.

---

## 3. Princípio de modelagem — unidades tipadas

Decisão arquitetural central: **nenhuma unidade de medida é texto livre**. Todo campo de unidade é um enum que carrega a própria conversão, eliminando a classe de erro "stringly-typed" (`"kg"`, `"Kg"`, `"quilo"`…) e a digitação manual de fatores de conversão.

### Enum `UnidadeMedida` (tabela estática, em código — não é dado do usuário)

| Valor | Dimensão | `fatorParaBase` (→ base canônica) |
|-------|----------|-----------------------------------|
| `G`   | PESO     | 1                                 |
| `KG`  | PESO     | 1000                              |
| `ML`  | VOLUME   | 1                                 |
| `L`   | VOLUME   | 1000                              |
| `UN`  | CONTAGEM | 1                                 |

Bases canônicas: PESO → grama, VOLUME → mililitro, CONTAGEM → unidade. O sistema **conhece** que `KG → G` é ×1000; o usuário nunca digita esse fator.

### Regra de dimensão (rígida)

Um item de ficha técnica só pode consumir um insumo em **unidade da mesma dimensão** do insumo. Ex.: um insumo comprado em `KG` (PESO) só aceita consumo em `G` ou `KG`, nunca em `ML`. Conversão peso↔volume por densidade é **explicitamente proibida** nesta versão (ver §10 — fica para uma feature estruturada futura).

### Dinheiro em centavos

Todo valor monetário é armazenado como **inteiro em centavos** (`Int`), nunca `float`, para evitar acúmulo de erro de arredondamento. Custos derivados fracionários (ex.: R$ 0,012/g) são calculados em tempo de execução, não persistidos.

---

## 4. Modelo de domínio

### 4.1 `Insumo`
Matéria-prima ou embalagem. Onde nasce o custo.

| Campo | Tipo | Ex. | Observação |
|-------|------|-----|------------|
| `nome` | string | "Chocolate em pó" | |
| `tipo` | `TipoInsumo` | `INGREDIENTE` \| `EMBALAGEM` | embalagem tratada como insumo, só marcada diferente |
| `unidadeCompra` | `UnidadeMedida` | `KG` | enum — sem texto livre |
| `qtdCompra` | decimal | `1` | quantas dessas unidades você compra pelo `precoCompra` |
| `precoCompra` | int (centavos) | `1200` (R$12,00) | preço pago pela compra acima |

**Custo derivado (não persistido):**
```
custoPorBase = precoCompra ÷ (qtdCompra × unidadeCompra.fatorParaBase)
```
Ex. chocolate: `1200 ÷ (1 × 1000)` = **1,2 centavos/g**.

### 4.2 `FichaTecnica`
A receita/produto vendável.

| Campo | Tipo | Ex. | Observação |
|-------|------|-----|------------|
| `nome` | string | "Brigadeiro tradicional" | |
| `rendimento` | decimal | `100` | unidades produzidas no lote |
| `maoDeObraPorCento` | int (centavos) | `2000` (R$20) | valor fixo arbitrado |
| `margem` | decimal? | `0.60` | override; se `null`, usa a margem padrão global |
| `itens` | `FichaTecnicaItem[]` | | ingredientes **e** embalagens |

### 4.3 `FichaTecnicaItem`
Consumo de um insumo dentro de uma ficha.

| Campo | Tipo | Ex. | Observação |
|-------|------|-----|------------|
| `insumoId` | ref | | |
| `qtdUso` | decimal | `200` | |
| `unidadeUso` | `UnidadeMedida` | `G` | **validado:** mesma dimensão do insumo |

**Custo do item (derivado):**
```
custoItem = qtdUso × unidadeUso.fatorParaBase × insumo.custoPorBase
```
Ex.: `200 × 1 × 0,012` = **R$ 2,40**.

### 4.4 `ConfiguracaoPrecificacao` (singleton)

| Campo | Tipo | Ex. | Observação |
|-------|------|-----|------------|
| `margemPadrao` | decimal | `0.60` | markup padrão usado quando a ficha não tem override |

---

## 5. Cálculo — do custo ao preço

### 5.1 Custo
```
custoInsumosLote  = Σ custoItem                          (todos os itens da ficha)
custoInsumosCento = custoInsumosLote ÷ (rendimento ÷ 100)
custoTotalCento   = custoInsumosCento + maoDeObraPorCento
```

### 5.2 Preço (markup)
```
margemEfetiva = ficha.margem ?? config.margemPadrao
precoExato    = custoTotalCento × (1 + margemEfetiva)
precoCento    = arredondaParaCima(precoExato, múltiplo de R$1,00)
precoMeioCento= arredondaParaCima(precoCento ÷ 2, múltiplo de R$1,00)
```

O sistema expõe **tanto o `precoExato` quanto o `precoCento` arredondado** (transparência).

### 5.3 Exemplo ponta a ponta (cento de brigadeiro)
- Insumos no lote de 100 un: R$ 45,00
- `custoInsumosCento` = 45 ÷ (100÷100) = R$ 45,00
- + MO R$ 20,00 → `custoTotalCento` = **R$ 65,00**
- margem 60% (markup): `precoExato` = 65 × 1,60 = R$ 104,00 → `precoCento` = **R$ 104,00**
- `precoMeioCento` = arredonda(52,00) = **R$ 52,00**

---

## 6. Regras de validação

1. **Dimensão rígida:** `FichaTecnicaItem.unidadeUso` deve ter a mesma dimensão de `Insumo.unidadeCompra`. Rejeitar no service (o Zod da rota não conhece o insumo referenciado; a checagem exige buscar o insumo).
2. **Dinheiro:** entradas monetárias são inteiros ≥ 0 em centavos.
3. **Quantidades:** `qtdCompra`, `qtdUso`, `rendimento` > 0.
4. **Margem:** decimal ≥ 0 (0.60 = 60%).
5. **Exclusão de insumo:** impedir (ou avisar) exclusão de insumo referenciado por alguma ficha.

---

## 7. Arquitetura técnica

- **Stack existente:** Fastify 5 + `fastify-type-provider-zod` + Zod 4 + Swagger (já configurado em `src/server.ts`).
- **Persistência:** **Prisma + PostgreSQL** (o `tsconfig` já aponta `src/generated`, saída padrão do Prisma).
- **Estrutura em módulos** (padrão consistente por módulo):
  ```
  src/modules/
    insumos/           { routes, service, schema (zod), repository }
    fichas-tecnicas/   { routes, service, schema, repository }
    precificacao/      { routes, service, schema }   // orquestra cálculo, sem tabela própria além de ConfiguracaoPrecificacao
    shared/
      unidade-medida.ts   // enum + tabela fatorParaBase/dimensão + helpers de conversão e validação de dimensão
      money.ts            // helpers de centavos e arredondamento
  ```
- **Camadas por módulo:** `routes` (HTTP + Zod) → `service` (regras/cálculo) → `repository` (Prisma). O cálculo de custo/preço vive no `service` de `precificacao`, consumindo dados via repositories.
- `src/routes.ts` registra os routers de cada módulo.

### 7.1 Esboço do schema Prisma
```prisma
enum TipoInsumo { INGREDIENTE EMBALAGEM }
enum UnidadeMedida { G KG ML L UN }

model Insumo {
  id            String   @id @default(uuid())
  nome          String
  tipo          TipoInsumo
  unidadeCompra UnidadeMedida
  qtdCompra     Decimal
  precoCompra   Int                    // centavos
  itens         FichaTecnicaItem[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model FichaTecnica {
  id                String   @id @default(uuid())
  nome              String
  rendimento        Decimal
  maoDeObraPorCento Int                 // centavos
  margem            Decimal?            // override; null → margemPadrao
  itens             FichaTecnicaItem[]
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model FichaTecnicaItem {
  id             String   @id @default(uuid())
  fichaTecnicaId String
  fichaTecnica   FichaTecnica @relation(fields: [fichaTecnicaId], references: [id], onDelete: Cascade)
  insumoId       String
  insumo         Insumo   @relation(fields: [insumoId], references: [id], onDelete: Restrict)
  qtdUso         Decimal
  unidadeUso     UnidadeMedida
}

model ConfiguracaoPrecificacao {
  id           String  @id @default(uuid())
  margemPadrao Decimal
}
```

### 7.2 Endpoints (REST)
| Método | Rota | Descrição |
|--------|------|-----------|
| POST/GET | `/insumos` | criar / listar |
| GET/PATCH/DELETE | `/insumos/:id` | detalhe / editar / excluir (com trava §6.5) |
| POST/GET | `/fichas-tecnicas` | criar / listar |
| GET/PATCH/DELETE | `/fichas-tecnicas/:id` | detalhe (inclui itens) / editar / excluir |
| GET | `/fichas-tecnicas/:id/preco` | **saída-chave:** custo detalhado + preço cento + meio-cento |
| PATCH | `/fichas-tecnicas/:id/margem` | atualizar margem do produto (tela de margem por produto) |
| GET/PATCH | `/precificacao/config` | ler / atualizar margem padrão global |

---

## 8. Estratégia de testes

- **Unitários (núcleo do valor):** helpers de `unidade-medida` (conversão, `fatorParaBase`, validação de dimensão) e `money` (arredondamento pra cima em múltiplo de R$1). Casos: chocolate em kg→g, leite condensado em un, forminha em pacote (qtdCompra=100).
- **Unitários de cálculo:** `custoPorBase`, `custoItem`, `custoTotalCento`, markup, meio-cento — validando o exemplo da §5.3.
- **Validação:** rejeição de dimensão incompatível (peso × volume); dinheiro/quantidade inválidos.
- **Integração (rota-chave):** `GET /fichas-tecnicas/:id/preco` retorna a quebra de custo e os preços corretos ponta a ponta.

---

## 9. Esboço de escopo — módulos futuros (specs próprias)

Não implementados agora; registrados para ancorar o domínio.

- **Produção:** planeja e registra lotes produzidos a partir de fichas técnicas; **consome insumos** (baixa de estoque) conforme o rendimento. Conecta-se a Insumos (estoque) e Fichas (receita). Introduz o conceito de estoque/saldo de insumo, hoje ausente.
- **Pedidos:** pedidos de festa com data de entrega, itens (fichas técnicas em cento/meio-cento) e preço vindo da Precificação. Dispara demanda de Produção (o que produzir para quando). Conecta-se a Precificação (preço) e Produção (planejamento).

Dependência natural: `Insumos → Fichas/Precificação (esta spec) → Produção → Pedidos`.

---

## 10. Não-objetivos e decisões adiadas

- **Conversão peso↔volume por densidade** — proibida agora; feature estruturada futura.
- **Custos indiretos rateados** (gás, energia, aluguel — "camada 3").
- **Impostos e frete/entrega** no preço ("camada 4").
- **Controle de estoque/saldo de insumos** — chega com o módulo de Produção.
- **Autenticação/usuários** — o Swagger já prevê `BearerAuth`, mas auth não faz parte desta spec.

---

## 11. Glossário

- **Cento / meio-cento:** 100 / 50 unidades — a forma de venda.
- **Insumo:** matéria-prima ou embalagem consumida na produção.
- **Ficha técnica:** receita de um produto vendável (itens + rendimento + mão de obra).
- **Rendimento:** quantas unidades um lote da ficha produz.
- **Markup:** preço = custo × (1 + margem).
- **Dimensão:** grandeza física da unidade (PESO, VOLUME, CONTAGEM); base da validação rígida.
