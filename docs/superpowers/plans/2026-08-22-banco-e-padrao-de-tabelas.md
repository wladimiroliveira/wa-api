# Banco de dados e padrão de tabelas — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o projeto com PostgreSQL 17 rodando via Prisma, e com a convenção de nomes de tabelas e colunas garantida por teste automatizado.

**Architecture:** O banco fala snake_case e o TypeScript fala camelCase; o `@map`/`@@map` do Prisma é a fronteira. A convenção não vive em documento: um módulo puro lê `prisma/schema.prisma` como texto e devolve a lista de violações, e um teste roda esse módulo contra fixtures conhecidas e contra o schema real. Validação de ambiente, container do banco, cliente Prisma e verificador da convenção são quatro unidades independentes.

**Tech Stack:** Node 22 (`lts/jod`), TypeScript ESM (`module: nodenext`), Fastify 5, Zod 4.3.6, PostgreSQL 17, Prisma 6.19.3, Vitest 4.1.10.

**Spec:** `docs/superpowers/specs/2026-08-22-banco-e-padrao-de-tabelas-design.md`

## Global Constraints

- Identificadores, arquivos, testes e comentários em inglês. Documentação em português.
- Prettier `printWidth: 120`, `singleQuote: false`. `npx prettier --check .` precisa passar ao fim de cada tarefa.
- `moduleResolution: node16` — **todo import relativo exige extensão `.js` explícita**. Verificado: `import { PrismaClient } from "../generated/prisma"` falha com `TS2834`; só `"../generated/prisma/index.js"` compila.
- `@db.Uuid` é obrigatório em toda coluna `uuid`. Verificado: sem ele o Prisma materializa `TEXT`, não `UUID`.
- `@db.Decimal(p, s)` é obrigatório em todo `Decimal`. Sem ele o Prisma materializa `numeric(65,30)`.
- `@@index` sempre com `map: "idx_..."`. Verificado: o nome automático de índice composto é truncado em silêncio no limite de 63 caracteres do Postgres.
- PK, FK e unique usam o nome padrão do Prisma (`<tabela>_pkey`, `<tabela>_<coluna>_fkey`, `<tabela>_<coluna>_key`). Não use `map:` neles.
- **Commits só com ordem explícita do usuário** (regra do CLAUDE.md). O passo de commit de cada tarefa fica pendente até o usuário mandar; o trabalho terminado espera sujo na árvore.
- Branch de trabalho: `feat/database-and-table-standard`.

## File Structure

| Arquivo                                   | Responsabilidade                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/lib/env.ts`                          | Validar e tipar as variáveis de ambiente. Não conhece Prisma nem Fastify.                                     |
| `docker-compose.yml`                      | Subir o PostgreSQL 17 local com healthcheck e volume nomeado.                                                 |
| `prisma/schema.prisma`                    | Datasource, generator e — nas issues seguintes — os modelos do domínio.                                       |
| `src/lib/prisma.ts`                       | Instância única do cliente Prisma. Sem regra de negócio.                                                      |
| `scripts/schema-convention.ts`            | Função pura: recebe o texto do schema, devolve as violações da convenção. Não lê arquivo, não conhece Vitest. |
| `tests/lib/env.test.ts`                   | Testa `parseEnv` com fixtures.                                                                                |
| `tests/scripts/schema-convention.test.ts` | Testa o verificador com fixtures válidas e inválidas, e aplica ao schema real.                                |

---

### Task 1: Validação de ambiente

Primeira tarefa porque instala o Vitest, de que todas as outras dependem, e porque `DATABASE_URL` é o contrato entre o container do banco e o Prisma.

**Files:**

- Create: `src/lib/env.ts`
- Create: `tests/lib/env.test.ts`
- Modify: `package.json` (dependência `vitest`, scripts `test` e `test:watch`)

**Interfaces:**

- Consumes: nada.
- Produces: `parseEnv(source: NodeJS.ProcessEnv): Env` e `loadEnv(): Env`, onde `Env = { API_PORT: number; DATABASE_URL: string }`. A Task 3 usa `loadEnv()`.

- [ ] **Step 1: Instalar o Vitest e registrar os scripts**

```bash
npm i -D vitest@4.1.10
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:watch="vitest"
```

- [ ] **Step 2: Escrever o teste que falha**

Crie `tests/lib/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/lib/env.js";

describe("parseEnv", () => {
  it("accepts a postgres connection string and defaults the port", () => {
    expect(parseEnv({ DATABASE_URL: "postgresql://user:pass@localhost:5432/wa_api" })).toEqual({
      API_PORT: 3333,
      DATABASE_URL: "postgresql://user:pass@localhost:5432/wa_api",
    });
  });

  it("names the offending variable when DATABASE_URL is missing", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("rejects a connection string that is not postgres", () => {
    expect(() => parseEnv({ DATABASE_URL: "mysql://user:pass@localhost:3306/wa_api" })).toThrow(/DATABASE_URL/);
  });

  it("coerces API_PORT from the string the environment provides", () => {
    const env = parseEnv({ DATABASE_URL: "postgres://user:pass@localhost:5432/wa_api", API_PORT: "4000" });
    expect(env.API_PORT).toBe(4000);
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar o vermelho**

Run: `npx vitest run tests/lib/env.test.ts`
Expected: FAIL — `Failed to load ../../src/lib/env.js` (o módulo ainda não existe). Cole a saída antes de seguir.

- [ ] **Step 4: Implementar**

Crie `src/lib/env.ts`:

```ts
import { z } from "zod";

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${details}`);
  }

  return result.data;
}

let cached: Env | null = null;

export function loadEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
```

`z.url({ protocol })` e `z.coerce.number()` foram verificados no Zod 4.3.6. A mensagem de erro carrega o caminho da variável, que é o que os dois testes de rejeição casam.

- [ ] **Step 5: Rodar o teste e confirmar o verde**

Run: `npx vitest run tests/lib/env.test.ts`
Expected: PASS, 4 testes.

- [ ] **Step 6: Verificar formatação**

Run: `npx prettier --check .`
Expected: `All matched files use Prettier code style!`

- [ ] **Step 7: Commit (somente com ordem explícita do usuário)**

```bash
git add package.json package-lock.json src/lib/env.ts tests/lib/env.test.ts
git commit -m "feat(env): validate the environment variables with zod"
```

---

### Task 2: PostgreSQL 17 local por docker compose

**Files:**

- Create: `docker-compose.yml`
- Modify: `.example.env`
- Modify: `package.json` (scripts `services:up` e `services:down`)

**Interfaces:**

- Consumes: nada.
- Produces: um Postgres em `localhost:${POSTGRES_PORT}` com o banco `${POSTGRES_DB}`, alcançável pela `DATABASE_URL` do `.example.env`. A Task 3 conecta nele.

Esta tarefa é configuração de infraestrutura, não código: não há teste unitário que prove algo além de reescrever o próprio arquivo YAML. A evidência é a saída do healthcheck do container, exigida no Step 4.

- [ ] **Step 1: Escrever o docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:17-alpine
    container_name: wa-api-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: ${POSTGRES_DB:-wa_api}
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - wa-api-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-wa_api}"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  wa-api-pgdata:
```

- [ ] **Step 2: Declarar as variáveis no `.example.env`**

Substitua o conteúdo por:

```
API_PORT=3333

POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=wa_api
POSTGRES_PORT=5432

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wa_api?schema=public
```

O `.gitignore` já ignora `.env*`; `.example.env` não casa com esse padrão e continua versionado.

- [ ] **Step 3: Registrar os scripts**

```bash
npm pkg set scripts.services:up="docker compose up -d --wait"
npm pkg set scripts.services:down="docker compose down"
```

- [ ] **Step 4: Subir o banco e colar a evidência**

```bash
cp .example.env .env
npm run services:up
docker compose ps
```

Expected: o serviço `postgres` aparece com status `healthy`. Se `docker compose up --wait` retornar diferente de zero, o container não ficou saudável — resolva antes de seguir, não prossiga com "deve subir".

- [ ] **Step 5: Verificar formatação**

Run: `npx prettier --check .`
Expected: `All matched files use Prettier code style!`

- [ ] **Step 6: Commit (somente com ordem explícita do usuário)**

```bash
git add docker-compose.yml .example.env package.json
git commit -m "chore(db): run postgres 17 locally with docker compose"
```

---

### Task 3: Prisma inicializado com a convenção

**Files:**

- Create: `prisma/schema.prisma`
- Create: `src/lib/prisma.ts`
- Modify: `.gitignore` (ignorar `src/generated`)
- Modify: `package.json` (dependências `prisma` e `@prisma/client`, scripts `db:migrate`, `db:generate`, `build`)

**Interfaces:**

- Consumes: `loadEnv()` da Task 1 e o Postgres da Task 2.
- Produces: `prisma/schema.prisma` (o arquivo que a Task 4 verifica) e `export const prisma: PrismaClient` em `src/lib/prisma.ts`.

- [ ] **Step 1: Instalar o Prisma**

```bash
npm i -D prisma@6.19.3
npm i @prisma/client@6.19.3
```

- [ ] **Step 2: Escrever o schema**

Crie `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Sem modelos de propósito: a issue #36 define o padrão, e as issues seguintes modelam o domínio sobre ele. O `output` aponta para `src/generated/prisma`, caminho que o `include` do `tsconfig.json` já contempla (`./src/generated/**/*`).

- [ ] **Step 3: Ignorar o cliente gerado**

Acrescente ao `.gitignore`:

```
# PRISMA
src/generated
```

- [ ] **Step 4: Registrar os scripts**

```bash
npm pkg set scripts.db:generate="prisma generate"
npm pkg set scripts.db:migrate="prisma migrate dev"
npm pkg set scripts.build:prisma-client="node --input-type=commonjs --eval \"require('node:fs').cpSync('src/generated', 'dist/generated', { recursive: true })\""
npm pkg set scripts.build="tsc && npm run build:prisma-client"
```

O cliente gerado é JavaScript, e o `tsc` do projeto não emite `.js` de entrada — sem o passo de cópia, `dist/` sairia sem o cliente e `npm start` quebraria ao carregar `dist/lib/prisma.js`.

- [ ] **Step 5: Validar o schema e gerar o cliente**

```bash
npx prisma validate
npm run db:generate
```

Expected: `The schema at prisma/schema.prisma is valid 🚀` seguido de `✔ Generated Prisma Client (v6.19.3)`. Cole as duas saídas.

- [ ] **Step 6: Criar o cliente**

Crie `src/lib/prisma.ts`:

```ts
import { PrismaClient } from "../generated/prisma/index.js";
import { loadEnv } from "./env.js";

loadEnv();

export const prisma = new PrismaClient();
```

O `loadEnv()` no topo faz o processo falhar cedo, com mensagem nomeando a variável, em vez de o Prisma estourar um erro de conexão obscuro. A extensão `/index.js` é obrigatória: verificado que `"../generated/prisma"` falha com `TS2834` sob `moduleResolution: node16`.

- [ ] **Step 7: Confirmar que compila**

```bash
npx tsc --noEmit
```

Expected: nenhuma saída, código de saída 0.

- [ ] **Step 8: Verificar formatação**

Run: `npx prettier --check .`
Expected: `All matched files use Prettier code style!`

- [ ] **Step 9: Commit (somente com ordem explícita do usuário)**

```bash
git add prisma/schema.prisma src/lib/prisma.ts .gitignore package.json package-lock.json
git commit -m "feat(db): set up prisma against postgres"
```

---

### Task 4: A convenção verificada por teste

O coração da issue #36. Sem esta tarefa, a convenção é um documento que ninguém executa.

**Files:**

- Create: `scripts/schema-convention.ts`
- Create: `tests/scripts/schema-convention.test.ts`

**Interfaces:**

- Consumes: `prisma/schema.prisma` da Task 3.
- Produces: `findSchemaConventionViolations(source: string): SchemaViolation[]`, onde `SchemaViolation = { model: string; field: string | null; rule: string; message: string }`. Os valores de `rule` são exatamente: `table-map`, `table-snake-case`, `table-plural`, `index-map`, `index-prefix`, `column-snake-case`, `uuid-native-type`, `foreign-key-suffix`, `decimal-precision`, `timestamptz`, `datetime-suffix`, `boolean-prefix`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `tests/scripts/schema-convention.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findSchemaConventionViolations } from "../../scripts/schema-convention.js";

const COMPLIANT_MODEL = `
model StockMovement {
  id           String   @id @default(uuid(7)) @db.Uuid
  supplyId     String   @map("supply_id") @db.Uuid
  quantityBase Decimal  @map("quantity_base") @db.Decimal(18, 6)
  isReversal   Boolean  @default(false) @map("is_reversal")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  @@index([supplyId, createdAt(sort: Desc), id(sort: Desc)], map: "idx_stock_movements_supply_id_created_at")
  @@map("stock_movements")
}
`;

const rulesFor = (source: string) => findSchemaConventionViolations(source).map((violation) => violation.rule);

describe("findSchemaConventionViolations", () => {
  it("accepts a model that follows every rule", () => {
    expect(findSchemaConventionViolations(COMPLIANT_MODEL)).toEqual([]);
  });

  it("rejects a model without @@map", () => {
    expect(rulesFor(COMPLIANT_MODEL.replace(`  @@map("stock_movements")\n`, ""))).toContain("table-map");
  });

  it("rejects a table name that is not plural", () => {
    expect(rulesFor(COMPLIANT_MODEL.replace(`"stock_movements"`, `"stock_movement"`))).toContain("table-plural");
  });

  it("rejects a camelCase column that has no @map", () => {
    expect(rulesFor(COMPLIANT_MODEL.replace(`@map("supply_id") `, ""))).toContain("column-snake-case");
  });

  it("rejects an identifier column without @db.Uuid, which would become TEXT", () => {
    expect(rulesFor(COMPLIANT_MODEL.replace(`@default(uuid(7)) @db.Uuid`, `@default(uuid(7))`))).toContain(
      "uuid-native-type",
    );
  });

  it("rejects a Decimal without explicit precision, which would become numeric(65,30)", () => {
    expect(rulesFor(COMPLIANT_MODEL.replace(` @db.Decimal(18, 6)`, ""))).toContain("decimal-precision");
  });

  it("rejects a DateTime that is not timestamptz", () => {
    expect(rulesFor(COMPLIANT_MODEL.replace(` @db.Timestamptz(3)`, ""))).toContain("timestamptz");
  });

  it("rejects a DateTime field that does not end with At", () => {
    expect(rulesFor(COMPLIANT_MODEL.replace("createdAt    DateTime", "creation     DateTime"))).toContain(
      "datetime-suffix",
    );
  });

  it("rejects a Boolean field that starts with neither is nor has", () => {
    expect(rulesFor(COMPLIANT_MODEL.replace("isReversal   Boolean", "reversal     Boolean"))).toContain(
      "boolean-prefix",
    );
  });

  it("rejects an @@index without an explicit map, whose generated name can be truncated", () => {
    expect(rulesFor(COMPLIANT_MODEL.replace(`, map: "idx_stock_movements_supply_id_created_at"`, ""))).toContain(
      "index-map",
    );
  });

  it("keeps the project schema free of violations", () => {
    expect(findSchemaConventionViolations(readFileSync("prisma/schema.prisma", "utf8"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar o vermelho**

Run: `npx vitest run tests/scripts/schema-convention.test.ts`
Expected: FAIL — `Failed to load ../../scripts/schema-convention.js`. Cole a saída antes de seguir.

- [ ] **Step 3: Implementar o verificador**

Crie `scripts/schema-convention.ts`:

```ts
export type SchemaViolation = {
  model: string;
  field: string | null;
  rule: string;
  message: string;
};

type Block = { kind: "model" | "enum"; name: string; body: string };
type Field = { name: string; type: string; attributes: string };

const SCALAR_TYPES = new Set(["String", "Boolean", "Int", "BigInt", "Float", "Decimal", "DateTime", "Json", "Bytes"]);
const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const blockPattern = /^(model|enum)\s+(\w+)\s*\{([\s\S]*?)^\}/gm;

  for (const match of source.matchAll(blockPattern)) {
    blocks.push({ kind: match[1] as Block["kind"], name: match[2], body: match[3] });
  }

  return blocks;
}

function parseFields(body: string): Field[] {
  const fields: Field[] = [];

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("//") || line.startsWith("@@")) continue;

    const match = /^(\w+)\s+(\w+)(?:\[\])?\??\s*(.*)$/.exec(line);
    if (match === null) continue;

    fields.push({ name: match[1], type: match[2], attributes: match[3] });
  }

  return fields;
}

function readQuotedArgument(source: string, pattern: RegExp): string | null {
  const match = pattern.exec(source);
  return match === null ? null : match[1];
}

export function findSchemaConventionViolations(source: string): SchemaViolation[] {
  const violations: SchemaViolation[] = [];
  const blocks = parseBlocks(source);
  const enumNames = new Set(blocks.filter((block) => block.kind === "enum").map((block) => block.name));

  for (const model of blocks.filter((block) => block.kind === "model")) {
    const report = (field: string | null, rule: string, message: string) => {
      violations.push({ model: model.name, field, rule, message });
    };

    const tableName = readQuotedArgument(model.body, /@@map\("([^"]+)"\)/);

    if (tableName === null) {
      report(null, "table-map", "model does not declare @@map");
    } else if (!SNAKE_CASE.test(tableName)) {
      report(null, "table-snake-case", `table "${tableName}" is not snake_case`);
    } else if (!tableName.endsWith("s")) {
      report(null, "table-plural", `table "${tableName}" is not plural`);
    }

    for (const [index] of model.body.matchAll(/@@index\([^\n]*\)/g)) {
      const indexName = readQuotedArgument(index, /map:\s*"([^"]+)"/);

      if (indexName === null) {
        report(null, "index-map", "@@index without an explicit map, whose generated name can be truncated");
      } else if (!indexName.startsWith("idx_")) {
        report(null, "index-prefix", `index "${indexName}" does not start with idx_`);
      }
    }

    const scalarFields = parseFields(model.body).filter(
      (field) => SCALAR_TYPES.has(field.type) || enumNames.has(field.type),
    );

    for (const field of scalarFields) {
      const column = readQuotedArgument(field.attributes, /@map\("([^"]+)"\)/) ?? field.name;
      const isPrimaryKey = /@id\b/.test(field.attributes);
      const isForeignKey = !isPrimaryKey && field.name.endsWith("Id");

      if (!SNAKE_CASE.test(column)) {
        report(field.name, "column-snake-case", `column "${column}" is not snake_case`);
      }

      if (field.type === "String" && (isPrimaryKey || isForeignKey) && !/@db\.Uuid\b/.test(field.attributes)) {
        report(field.name, "uuid-native-type", "identifier without @db.Uuid becomes TEXT instead of UUID");
      }

      if (isForeignKey && !column.endsWith("_id")) {
        report(field.name, "foreign-key-suffix", `foreign key column "${column}" does not end with _id`);
      }

      if (field.type === "Decimal" && !/@db\.Decimal\(\d+,\s*\d+\)/.test(field.attributes)) {
        report(field.name, "decimal-precision", "Decimal without @db.Decimal(p, s) becomes numeric(65,30)");
      }

      if (field.type === "DateTime") {
        if (!/@db\.Timestamptz\(3\)/.test(field.attributes)) {
          report(field.name, "timestamptz", "DateTime without @db.Timestamptz(3)");
        }

        if (!field.name.endsWith("At")) {
          report(field.name, "datetime-suffix", `DateTime field "${field.name}" does not end with At`);
        }
      }

      if (field.type === "Boolean" && !/^(is|has)[A-Z]/.test(field.name)) {
        report(field.name, "boolean-prefix", `Boolean field "${field.name}" starts with neither is nor has`);
      }
    }
  }

  return violations;
}
```

- [ ] **Step 4: Rodar o teste e confirmar o verde**

Run: `npx vitest run tests/scripts/schema-convention.test.ts`
Expected: PASS, 11 testes.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS, 15 testes (4 da Task 1 e 11 desta).

- [ ] **Step 6: Verificar formatação e compilação**

```bash
npx prettier --check .
npx tsc --noEmit
```

Expected: `All matched files use Prettier code style!` e nenhuma saída do `tsc`.

- [ ] **Step 7: Commit (somente com ordem explícita do usuário)**

```bash
git add scripts/schema-convention.ts tests/scripts/schema-convention.test.ts
git commit -m "test(db): enforce the schema naming convention automatically"
```

---

## O que a spec cobre e este plano não implementa

A Decisão 3 da spec — movimentação append-only, preço como snapshot, paginação
por cursor, `onDelete: Restrict` mais `is_active`, UTC no banco — é regra de
modelagem: só tem onde ser aplicada quando existirem tabelas de domínio, e a
issue #36 não as modela. Elas não foram esquecidas; entram nas issues que criarem
as tabelas, e a spec é a referência que essas issues consultam.

Duas regras da Decisão 2 também são de julgamento e não viram teste: a escolha
entre enum do Postgres e tabela de apoio, e a escolha da linha certa na tabela de
tipos canônicos. O verificador exige que todo `Decimal` declare precisão, mas não
exige que ela seja `(18,6)` ou `(18,2)` — a spec prevê que a tabela de tipos ganhe
linhas novas, e travar os valores impediria isso.

## Limitações aceitas

- **Plural por heurística.** A regra `table-plural` verifica se o nome termina em `s`. Plurais irregulares em inglês passariam despercebidos; nenhum nome de tabela previsto para este domínio cai nesse caso.
- **PK `String` é sempre UUID.** A regra `uuid-native-type` acusa qualquer `String @id` sem `@db.Uuid`. Uma chave primária textual legítima daria falso positivo — a convenção diz que não existe uma.
- **Check constraints ficam de fora.** O Prisma não as modela; as constraints `ck_` são escritas à mão dentro da migration gerada e o verificador não as enxerga.
- **`@map` só é exigido quando o nome difere.** A regra `column-snake-case` valida
  o nome efetivo da coluna: um campo já em snake_case, como `id` ou `name`, passa
  sem `@map`. Exigir `@map("id")` seria ruído sem ganho.
- **O verificador lê texto, não a AST do Prisma.** Em troca, não depende de banco no ar nem de cliente gerado. Se o formato do `schema.prisma` mudar entre versões do Prisma, o parser precisa acompanhar.
