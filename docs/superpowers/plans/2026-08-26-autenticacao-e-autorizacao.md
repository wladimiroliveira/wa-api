# Autenticação e autorização — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar a API atrás de autenticação por token e autorização por permissão de módulo, entregando a issue #35.

**Architecture:** Papel opcional mais permissões avulsas somando numa função pura; access token JWT de 15 minutos mais refresh token opaco no banco, com rotação e detecção de reuso; cada rota declara seu acesso na própria definição e o registro de uma rota sem declaração derruba o boot.

**Tech Stack:** Node 22 ESM, TypeScript strict, Fastify 5, `fastify-type-provider-zod`, Zod 4, Prisma 6 sobre PostgreSQL 17, Vitest 4, `@fastify/jwt`, `@fastify/rate-limit`, `scrypt` do `node:crypto`.

**Spec:** `docs/superpowers/specs/2026-08-26-arquitetura-de-autenticacao-e-autorizacao-design.md`

**Convenção de banco:** `docs/superpowers/specs/2026-08-22-banco-e-padrao-de-tabelas-design.md`

## Global Constraints

- Identificadores, arquivos, testes e comentários em inglês. Documentação em português.
- TDD sem exceção: o teste que falha vem primeiro, e a saída vermelha é colada antes da implementação.
- Toda tabela segue a convenção da #36: `@@map` snake*case plural, `@map` snake_case em todo campo, `@db.Uuid` em PK e FK, `@db.Timestamptz(3)` em todo `DateTime`, `@@index` com `map:` prefixado por `idx*`, enum com `@@map`snake_case e valores`SCREAMING_SNAKE`.
- `tests/scripts/schema-convention.test.ts` valida o `prisma/schema.prisma` real. Ele trata campo de enum como escalar: `extraPermissions` precisa de `@map("extra_permissions")`.
- Imports relativos terminam em `.js`, como o resto do projeto (`moduleResolution: node16`).
- Prettier com `printWidth: 120` e aspas duplas. `npx prettier --check .` faz parte do fecho de cada tarefa.
- `npm run typecheck` cobre `src`, `scripts` e `tests`.
- `@fastify/jwt` e `@fastify/rate-limit` entram em `dependencies`, nunca em `devDependencies`.
- Commits em uma linha, `type(scope): what the change does`, sem corpo.
- Nunca commitar na `main`. O trabalho fica na branch da fase.

## Estrutura de arquivos

| Arquivo                                  | Responsabilidade                                              |
| ---------------------------------------- | ------------------------------------------------------------- |
| `prisma/schema.prisma`                   | Enum `Permission` e os modelos `Role`, `User`, `RefreshToken` |
| `src/lib/api-version.ts`                 | A versão da API e o prefixo de todas as rotas, num lugar só   |
| `src/app.ts`                             | Monta a instância Fastify e devolve; sem `listen`             |
| `src/server.ts`                          | Só o `listen`, usando `buildApp()`                            |
| `src/modules/auth/auth.permissions.ts`   | Função pura da permissão efetiva                              |
| `src/modules/auth/auth.password.ts`      | Hash e verificação de senha com scrypt                        |
| `src/modules/auth/auth.refresh-token.ts` | Geração e hash do refresh token                               |
| `src/modules/auth/auth.jwt.ts`           | Plugin do access token: assinar e verificar                   |
| `src/modules/auth/auth.access.ts`        | `PUBLIC`, `AUTHENTICATED`, hook `onRoute` e hook `onRequest`  |
| `src/modules/auth/auth.repository.ts`    | Consultas de usuário e refresh token                          |
| `src/modules/auth/auth.service.ts`       | Login, refresh com rotação, logout, revogação                 |
| `src/modules/auth/auth.schemas.ts`       | Schemas Zod das rotas de sessão                               |
| `src/modules/auth/auth.routes.ts`        | `/sessions`, `/sessions/refresh`, `/me`                       |
| `src/modules/roles/roles.repository.ts`  | Consultas de papel                                            |
| `src/modules/roles/roles.schemas.ts`     | Schemas Zod de papel                                          |
| `src/modules/roles/roles.routes.ts`      | CRUD de papel                                                 |
| `src/modules/users/users.repository.ts`  | Consultas de usuário                                          |
| `src/modules/users/users.schemas.ts`     | Schemas Zod de usuário                                        |
| `src/modules/users/users.routes.ts`      | CRUD de usuário e troca de senha                              |
| `prisma/seed.ts`                         | Papel `Owner` e usuário inicial                               |
| `tests/support/database.ts`              | Cliente de teste e limpeza entre testes                       |
| `tests/support/app.ts`                   | Instância da aplicação e helpers de autenticação nos testes   |

O plano tem duas fases. A **Fase 1** entrega a API fechada e o login funcionando — é um PR completo e testável sozinho. A **Fase 2** entrega a administração de acesso. Cada fase é um PR.

---

# Fase 1 — fundação da autenticação

Branch: `feat/auth-foundation`

Todos os caminhos deste plano seguem a Decisão 5 do spec: o prefixo `/v1` é aplicado uma única vez,
no registro do módulo de rotas, e nenhuma rota o escreve no próprio caminho. O que aparece nos blocos
de `src` é sempre o caminho sem versão; o que aparece nos testes e na documentação é o caminho
completo que o cliente chama.

### Task 1: Schema, enum de permissões e migration

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_auth_tables/migration.sql` (gerada pelo Prisma)
- Test: `tests/prisma/auth-schema.test.ts`

**Interfaces:**

- Consumes: nada.
- Produces: o enum `Permission` e os tipos `User`, `Role`, `RefreshToken` exportados de `src/generated/prisma/index.js`. `Permission` tem exatamente treze valores: `CATALOG_READ`, `CATALOG_CREATE`, `CATALOG_UPDATE`, `ENTRIES_READ`, `ENTRIES_CREATE`, `PRODUCTION_READ`, `PRODUCTION_CREATE`, `SALES_READ`, `SALES_CREATE`, `REPORTS_READ`, `ACCESS_READ`, `ACCESS_CREATE`, `ACCESS_UPDATE`.

- [ ] **Step 1: Write the failing test**

Crie `tests/prisma/auth-schema.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findSchemaConventionViolations } from "../../scripts/schema-convention.js";

const SCHEMA = readFileSync(fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)), "utf8");

const PERMISSIONS = [
  "CATALOG_READ",
  "CATALOG_CREATE",
  "CATALOG_UPDATE",
  "ENTRIES_READ",
  "ENTRIES_CREATE",
  "PRODUCTION_READ",
  "PRODUCTION_CREATE",
  "SALES_READ",
  "SALES_CREATE",
  "REPORTS_READ",
  "ACCESS_READ",
  "ACCESS_CREATE",
  "ACCESS_UPDATE",
];

describe("auth schema", () => {
  it("declares every permission the spec lists, and nothing else", () => {
    const block = /enum Permission \{([\s\S]*?)\n\}/.exec(SCHEMA);
    expect(block).not.toBeNull();

    const values = block![1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("@@"));

    expect(values.sort()).toEqual([...PERMISSIONS].sort());
  });

  it("maps the enum type to snake_case", () => {
    expect(SCHEMA).toMatch(/enum Permission \{[\s\S]*?@@map\("permission"\)/);
  });

  it("declares the three auth tables", () => {
    expect(SCHEMA).toMatch(/model Role \{[\s\S]*?@@map\("roles"\)/);
    expect(SCHEMA).toMatch(/model User \{[\s\S]*?@@map\("users"\)/);
    expect(SCHEMA).toMatch(/model RefreshToken \{[\s\S]*?@@map\("refresh_tokens"\)/);
  });

  it("keeps the user's own permissions under a name that cannot be read as the effective set", () => {
    expect(SCHEMA).toMatch(/extraPermissions\s+Permission\[\]\s+@map\("extra_permissions"\)/);
  });

  it("indexes refresh tokens by user, because revoking in bulk is routine", () => {
    expect(SCHEMA).toMatch(/@@index\(\[userId\], map: "idx_refresh_tokens_user_id"\)/);
  });

  it("violates no rule of the table convention", () => {
    expect(findSchemaConventionViolations(SCHEMA)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/prisma/auth-schema.test.ts`
Expected: FAIL — `expected null not to be null`, porque o enum não existe no schema.

- [ ] **Step 3: Write the schema**

Acrescente ao final de `prisma/schema.prisma`:

```prisma
enum Permission {
  CATALOG_READ
  CATALOG_CREATE
  CATALOG_UPDATE
  ENTRIES_READ
  ENTRIES_CREATE
  PRODUCTION_READ
  PRODUCTION_CREATE
  SALES_READ
  SALES_CREATE
  REPORTS_READ
  ACCESS_READ
  ACCESS_CREATE
  ACCESS_UPDATE

  @@map("permission")
}

model Role {
  id          String       @id @default(uuid(7)) @db.Uuid
  name        String       @unique
  permissions Permission[]
  users       User[]
  createdAt   DateTime     @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt   DateTime     @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@map("roles")
}

model User {
  id               String         @id @default(uuid(7)) @db.Uuid
  name             String
  username         String         @unique
  passwordHash     String         @map("password_hash")
  roleId           String?        @map("role_id") @db.Uuid
  role             Role?          @relation(fields: [roleId], references: [id], onDelete: SetNull)
  extraPermissions Permission[]   @map("extra_permissions")
  isActive         Boolean        @default(true) @map("is_active")
  refreshTokens    RefreshToken[]
  createdAt        DateTime       @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime       @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@map("users")
}

model RefreshToken {
  id           String    @id @default(uuid(7)) @db.Uuid
  userId       String    @map("user_id") @db.Uuid
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash    String    @unique @map("token_hash")
  expiresAt    DateTime  @map("expires_at") @db.Timestamptz(3)
  revokedAt    DateTime? @map("revoked_at") @db.Timestamptz(3)
  replacedById String?   @map("replaced_by_id") @db.Uuid
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)

  @@index([userId], map: "idx_refresh_tokens_user_id")
  @@map("refresh_tokens")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/prisma/auth-schema.test.ts tests/scripts/schema-convention.test.ts`
Expected: PASS nos dois arquivos.

- [ ] **Step 5: Generate client and migration**

```bash
npm run services:up
npx prisma migrate dev --name add_auth_tables
```

Confira no SQL gerado que as colunas saíram em snake_case e que `id` é `UUID`, não `TEXT`.

- [ ] **Step 6: Typecheck and format**

Run: `npm run typecheck && npx prettier --check .`
Expected: sem erro.

- [ ] **Step 7: Commit**

```bash
git add prisma tests/prisma src/generated
git commit -m "feat(auth): add roles, users and refresh tokens to the schema"
```

### Task 2: `buildApp()` e infraestrutura de teste com banco

Testes de integração precisam de uma aplicação sem `listen` e de um banco isolado. O isolamento é por **schema do Postgres**, não por banco novo: o Prisma cria o schema do `search_path` sozinho ao migrar, então basta apontar a URL de teste para `?schema=test`.

**Files:**

- Create: `src/app.ts`
- Modify: `src/server.ts`
- Create: `vitest.config.ts`
- Create: `tests/support/database.global-setup.ts`
- Create: `tests/support/database.ts`
- Create: `tests/support/app.ts`
- Modify: `package.json:scripts`
- Modify: `.example.env`
- Test: `tests/app.integration.test.ts`

**Interfaces:**

- Consumes: nada das tarefas anteriores.
- Produces: `buildApp(): Promise<FastifyInstance>` em `src/app.ts`; `testPrisma` e `resetDatabase(): Promise<void>` em `tests/support/database.ts`; `startTestApp(): Promise<FastifyInstance>` em `tests/support/app.ts`.

- [ ] **Step 1: Write the failing test**

Crie `tests/app.integration.test.ts`:

```ts
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { resetDatabase, testPrisma } from "./support/database.js";
import { startTestApp } from "./support/app.js";

const app = await startTestApp();

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await app.close();
  await testPrisma.$disconnect();
});

describe("test infrastructure", () => {
  it("serves the built application without listening on a port", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/docs/json" });

    expect(response.statusCode).toBe(200);
  });

  it("reaches a migrated database", async () => {
    await testPrisma.role.create({ data: { name: "Temporary", permissions: [] } });

    expect(await testPrisma.role.count()).toBe(1);
  });

  it("starts each test from an empty database", async () => {
    expect(await testPrisma.role.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app.integration.test.ts`
Expected: FAIL — `Cannot find module './support/database.js'`.

- [ ] **Step 3: Extract `buildApp()`**

Crie `src/app.ts` com todo o conteúdo atual de `src/server.ts`, trocando a chamada de `listen` por um retorno:

```ts
import fastify, { FastifyInstance } from "fastify";
import routes from "./routes.js";
import { fastifySwagger } from "@fastify/swagger";
import { fastifySwaggerUi } from "@fastify/swagger-ui";
import { fastifyCors } from "@fastify/cors";
import { serializerCompiler, validatorCompiler, jsonSchemaTransform, ZodTypeProvider } from "fastify-type-provider-zod";
import { API_PREFIX } from "./lib/api-version.js";
import { loadEnv } from "./lib/env.js";

export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = fastify().withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifyCors, {
    origin: ["*"],
    methods: ["GET", "POST", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  await app.register(fastifySwagger, {
    openapi: {
      info: { title: "wa-api", description: "Backend para o wa-system", version: "0.0.0" },
      components: {
        securitySchemes: { BearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      },
      servers: [{ url: `http://localhost:${env.API_PORT}`, description: "Servidor local" }],
    },
    transform: jsonSchemaTransform,
  });

  await app.after(app.withTypeProvider);
  await app.register(fastifySwaggerUi, { routePrefix: `${API_PREFIX}/docs` });
  await app.register(routes, { prefix: API_PREFIX });
  await app.ready();

  return app;
}
```

Substitua `src/server.ts` inteiro por:

```ts
import { buildApp } from "./app.js";
import { loadEnv } from "./lib/env.js";

const env = loadEnv();
const app = await buildApp();

await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
console.log("Server is running");
```

- [ ] **Step 4: Write the test infrastructure**

Crie `tests/support/database.global-setup.ts`:

```ts
import { execSync } from "node:child_process";

// The test suite lives in its own Postgres schema of the development database. Prisma creates the
// schema named in the connection string, so no extra database has to be provisioned by hand.
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;

  if (url === undefined) {
    throw new Error("TEST_DATABASE_URL is required to run integration tests. See .example.env.");
  }

  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
}
```

Crie `tests/support/database.ts`:

```ts
import { PrismaClient } from "../../src/generated/prisma/index.js";

// vitest.config.ts points DATABASE_URL at the test schema for this project, so the tests and the
// application under test talk to the same database.
export const testPrisma = new PrismaClient();

// Truncating beats deleting row by row: it resets every table in one statement and does not depend
// on the order the foreign keys were declared in.
export async function resetDatabase(): Promise<void> {
  await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE "refresh_tokens", "users", "roles" RESTART IDENTITY CASCADE`);
}
```

Crie `tests/support/app.ts`:

```ts
import { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";

export async function startTestApp(): Promise<FastifyInstance> {
  return buildApp();
}
```

Crie `vitest.config.ts`:

```ts
import "dotenv/config";
import { defineConfig } from "vitest/config";

// src/lib/prisma.ts builds its client at import time, from DATABASE_URL. Handing the workers the
// test URL here is what keeps the suite off the development database: setting it inside a test file
// would already be too late, because the import chain ran first.
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/**/*.integration.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/**/*.integration.test.ts"],
          globalSetup: ["tests/support/database.global-setup.ts"],
          env: { DATABASE_URL: testDatabaseUrl },
          fileParallelism: false,
        },
      },
    ],
  },
});
```

`fileParallelism: false` porque os arquivos compartilham um schema só: rodar em paralelo faria um teste truncar a tabela que o outro acabou de popular.

Em `package.json`, troque o script `test` e acrescente os dois novos:

```json
"test": "vitest run --project unit",
"test:integration": "vitest run --project integration",
"test:all": "vitest run"
```

Em `.example.env`, acrescente:

```
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wa_api?schema=test
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm run services:up
npm run test:integration
```

Expected: os três testes de `tests/app.integration.test.ts` passam.

- [ ] **Step 6: Confirm the unit suite still runs without a database**

Run: `npm test`
Expected: PASS, sem subir docker.

- [ ] **Step 7: Typecheck, format and commit**

```bash
npm run typecheck && npx prettier --check .
git add src/app.ts src/server.ts vitest.config.ts tests package.json .example.env
git commit -m "test(app): run the built application against an isolated database schema"
```

### Task 3: Variáveis de ambiente da autenticação

Adicionar `JWT_SECRET` como obrigatório quebra os quatro testes atuais de `parseEnv`, que chamam a função sem ele. Atualizá-los faz parte desta tarefa.

**Files:**

- Modify: `src/lib/env.ts`
- Modify: `tests/lib/env.test.ts`
- Modify: `.example.env`

**Interfaces:**

- Consumes: nada.
- Produces: `Env` ganha `JWT_SECRET: string`, `ACCESS_TOKEN_TTL_MINUTES: number`, `REFRESH_TOKEN_TTL_DAYS: number`, `CORS_ORIGINS: string[]`.

- [ ] **Step 1: Write the failing test**

Em `tests/lib/env.test.ts`, acrescente uma constante e um bloco novo, e ajuste os casos existentes para incluir o segredo:

```ts
const JWT_SECRET = "a-secret-long-enough-to-be-taken-seriously";
const REQUIRED = { DATABASE_URL, JWT_SECRET };
```

Troque `parseEnv({ DATABASE_URL: "..." })` por `parseEnv({ ...REQUIRED })` nos casos que já existem, e o `toEqual` do primeiro caso passa a esperar os campos novos com seus padrões:

```ts
it("accepts a postgres connection string and defaults the port", () => {
  expect(parseEnv({ ...REQUIRED })).toEqual({
    API_PORT: 3333,
    DATABASE_URL,
    JWT_SECRET,
    ACCESS_TOKEN_TTL_MINUTES: 15,
    REFRESH_TOKEN_TTL_DAYS: 30,
    CORS_ORIGINS: [],
  });
});
```

No caso `loadEnv` que usa `vi.stubEnv`, acrescente `vi.stubEnv("JWT_SECRET", JWT_SECRET)` antes de cada `importEnv()`, e ajuste os `toEqual` do mesmo jeito.

Acrescente o bloco novo:

```ts
describe("authentication variables", () => {
  it("rejects a JWT secret short enough to be guessed", () => {
    expect(() => parseEnv({ DATABASE_URL, JWT_SECRET: "short" })).toThrow(/JWT_SECRET/);
  });

  it("names JWT_SECRET when it is missing", () => {
    expect(() => parseEnv({ DATABASE_URL })).toThrow(/JWT_SECRET/);
  });

  it("splits CORS_ORIGINS on commas and trims each origin", () => {
    const env = parseEnv({ ...REQUIRED, CORS_ORIGINS: "http://localhost:5173, https://app.example.com" });

    expect(env.CORS_ORIGINS).toEqual(["http://localhost:5173", "https://app.example.com"]);
  });

  it("reads the token lifetimes from the environment", () => {
    const env = parseEnv({ ...REQUIRED, ACCESS_TOKEN_TTL_MINUTES: "5", REFRESH_TOKEN_TTL_DAYS: "7" });

    expect(env.ACCESS_TOKEN_TTL_MINUTES).toBe(5);
    expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/env.test.ts`
Expected: FAIL — o primeiro caso reprova por campos ausentes no `toEqual`, e `rejects a JWT secret short enough to be guessed` não lança nada.

- [ ] **Step 3: Extend the schema**

Em `src/lib/env.ts`, troque o `envSchema`:

```ts
const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin !== ""),
    ),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/env.test.ts`
Expected: PASS.

- [ ] **Step 5: Document the variables**

Em `.example.env`, acrescente:

```
JWT_SECRET=change-me-to-at-least-32-characters-long
ACCESS_TOKEN_TTL_MINUTES=15
REFRESH_TOKEN_TTL_DAYS=30
CORS_ORIGINS=http://localhost:5173
```

Acrescente as mesmas chaves ao seu `.env` local, senão a aplicação para de subir.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npx prettier --check .
git add src/lib/env.ts tests/lib/env.test.ts .example.env
git commit -m "feat(env): require the authentication settings at startup"
```

### Task 4: Permissão efetiva

**Files:**

- Create: `src/modules/auth/auth.permissions.ts`
- Test: `tests/modules/auth/auth.permissions.test.ts`

**Interfaces:**

- Consumes: o enum `Permission` da Task 1.
- Produces: `effectivePermissions(input: { rolePermissions: Permission[]; extraPermissions: Permission[] }): Permission[]` e `hasPermission(permissions: Permission[], required: Permission): boolean`.

- [ ] **Step 1: Write the failing test**

Crie `tests/modules/auth/auth.permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Permission } from "../../../src/generated/prisma/index.js";
import { effectivePermissions, hasPermission } from "../../../src/modules/auth/auth.permissions.js";

describe("effectivePermissions", () => {
  it("unites what the role grants with what the user carries", () => {
    const permissions = effectivePermissions({
      rolePermissions: [Permission.SALES_READ, Permission.SALES_CREATE],
      extraPermissions: [Permission.REPORTS_READ],
    });

    expect([...permissions].sort()).toEqual([Permission.REPORTS_READ, Permission.SALES_CREATE, Permission.SALES_READ]);
  });

  it("keeps a permission present on both sides once", () => {
    const permissions = effectivePermissions({
      rolePermissions: [Permission.CATALOG_READ],
      extraPermissions: [Permission.CATALOG_READ],
    });

    expect(permissions).toEqual([Permission.CATALOG_READ]);
  });

  it("answers with the user's own permissions when there is no role", () => {
    expect(effectivePermissions({ rolePermissions: [], extraPermissions: [Permission.ENTRIES_CREATE] })).toEqual([
      Permission.ENTRIES_CREATE,
    ]);
  });

  it("answers empty for a user with neither role nor permissions", () => {
    expect(effectivePermissions({ rolePermissions: [], extraPermissions: [] })).toEqual([]);
  });
});

describe("hasPermission", () => {
  it("confirms a permission the user holds", () => {
    expect(hasPermission([Permission.SALES_READ], Permission.SALES_READ)).toBe(true);
  });

  it("denies a permission the user does not hold", () => {
    expect(hasPermission([Permission.SALES_READ], Permission.SALES_CREATE)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/auth/auth.permissions.test.ts`
Expected: FAIL — `Cannot find module '../../../src/modules/auth/auth.permissions.js'`.

- [ ] **Step 3: Write the implementation**

Crie `src/modules/auth/auth.permissions.ts`:

```ts
import { Permission } from "../../generated/prisma/index.js";

export type PermissionSources = {
  rolePermissions: Permission[];
  extraPermissions: Permission[];
};

// The single source of the answer. No route recomputes this: a second implementation is a second
// chance to get authorisation wrong.
export function effectivePermissions({ rolePermissions, extraPermissions }: PermissionSources): Permission[] {
  return [...new Set([...rolePermissions, ...extraPermissions])];
}

export function hasPermission(permissions: Permission[], required: Permission): boolean {
  return permissions.includes(required);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/auth/auth.permissions.test.ts`
Expected: PASS, seis casos.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npx prettier --check .
git add src/modules/auth/auth.permissions.ts tests/modules/auth/auth.permissions.test.ts
git commit -m "feat(auth): compute the effective permission from role and user"
```

### Task 5: Hash de senha com scrypt

**Files:**

- Create: `src/modules/auth/auth.password.ts`
- Test: `tests/modules/auth/auth.password.test.ts`

**Interfaces:**

- Consumes: nada.
- Produces: `hashPassword(plain: string): Promise<string>` e `verifyPassword(plain: string, digest: string): Promise<boolean>`. O digest tem o formato `scrypt$N$r$p$salt$hash`, com salt e hash em base64url.

- [ ] **Step 1: Write the failing test**

Crie `tests/modules/auth/auth.password.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../../src/modules/auth/auth.password.js";

const PASSWORD = "correct horse battery";

describe("hashPassword", () => {
  it("writes the parameters into the digest, so raising the cost later keeps old hashes valid", async () => {
    const digest = await hashPassword(PASSWORD);

    expect(digest).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  });

  it("salts each hash, so the same password never produces the same digest", async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it("never contains the password itself", async () => {
    expect(await hashPassword(PASSWORD)).not.toContain(PASSWORD);
  });
});

describe("verifyPassword", () => {
  it("accepts the password that produced the digest", async () => {
    expect(await verifyPassword(PASSWORD, await hashPassword(PASSWORD))).toBe(true);
  });

  it("rejects a different password", async () => {
    expect(await verifyPassword("wrong password", await hashPassword(PASSWORD))).toBe(false);
  });

  it("rejects a digest it cannot parse instead of throwing", async () => {
    expect(await verifyPassword(PASSWORD, "not-a-digest")).toBe(false);
  });

  it("rejects a digest whose algorithm it does not know", async () => {
    expect(await verifyPassword(PASSWORD, "bcrypt$16384$8$1$c2FsdA$aGFzaA")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/auth/auth.password.test.ts`
Expected: FAIL — `Cannot find module '../../../src/modules/auth/auth.password.js'`.

- [ ] **Step 3: Write the implementation**

Crie `src/modules/auth/auth.password.ts`:

```ts
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

// Cost lives in the digest rather than in a constant, so raising it later does not invalidate every
// password already stored. N=16384 with r=8 costs about 16 MB per verification, under Node's 32 MB
// default for maxmem.
const ALGORITHM = "scrypt";
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function encode(buffer: Buffer): string {
  return buffer.toString("base64url");
}

async function derive(plain: string, salt: Buffer, cost: number, blockSize: number, parallelism: number) {
  return (await scrypt(plain, salt, KEY_LENGTH, {
    N: cost,
    r: blockSize,
    p: parallelism,
    maxmem: 128 * cost * blockSize * 2,
  })) as Buffer;
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(plain, salt, COST, BLOCK_SIZE, PARALLELISM);

  return [ALGORITHM, COST, BLOCK_SIZE, PARALLELISM, encode(salt), encode(key)].join("$");
}

export async function verifyPassword(plain: string, digest: string): Promise<boolean> {
  const parts = digest.split("$");

  if (parts.length !== 6 || parts[0] !== ALGORITHM) return false;

  const [, cost, blockSize, parallelism, salt, expected] = parts;
  const expectedKey = Buffer.from(expected, "base64url");

  const key = await derive(plain, Buffer.from(salt, "base64url"), Number(cost), Number(blockSize), Number(parallelism));

  if (key.length !== expectedKey.length) return false;

  return timingSafeEqual(key, expectedKey);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/auth/auth.password.test.ts`
Expected: PASS, sete casos.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npx prettier --check .
git add src/modules/auth/auth.password.ts tests/modules/auth/auth.password.test.ts
git commit -m "feat(auth): hash passwords with scrypt and versioned parameters"
```

### Task 6: Geração e hash do refresh token

**Files:**

- Create: `src/modules/auth/auth.refresh-token.ts`
- Test: `tests/modules/auth/auth.refresh-token.test.ts`

**Interfaces:**

- Consumes: nada.
- Produces: `createRefreshToken(): { token: string; tokenHash: string }`, `hashRefreshToken(token: string): string` e `refreshTokenExpiration(now: Date, ttlDays: number): Date`.

- [ ] **Step 1: Write the failing test**

Crie `tests/modules/auth/auth.refresh-token.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createRefreshToken,
  hashRefreshToken,
  refreshTokenExpiration,
} from "../../../src/modules/auth/auth.refresh-token.js";

describe("createRefreshToken", () => {
  it("carries 32 bytes of randomness", () => {
    expect(Buffer.from(createRefreshToken().token, "base64url")).toHaveLength(32);
  });

  it("never repeats a token", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => createRefreshToken().token));

    expect(tokens.size).toBe(100);
  });

  it("pairs the token with the hash that will be stored in its place", () => {
    const { token, tokenHash } = createRefreshToken();

    expect(tokenHash).toBe(hashRefreshToken(token));
    expect(tokenHash).not.toBe(token);
  });
});

describe("hashRefreshToken", () => {
  it("answers the same hash for the same token", () => {
    expect(hashRefreshToken("a-token")).toBe(hashRefreshToken("a-token"));
  });

  it("answers a different hash for a different token", () => {
    expect(hashRefreshToken("a-token")).not.toBe(hashRefreshToken("another-token"));
  });
});

describe("refreshTokenExpiration", () => {
  it("adds the configured number of days to the moment it is called", () => {
    const now = new Date("2026-08-26T12:00:00.000Z");

    expect(refreshTokenExpiration(now, 30).toISOString()).toBe("2026-09-25T12:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/auth/auth.refresh-token.test.ts`
Expected: FAIL — `Cannot find module '../../../src/modules/auth/auth.refresh-token.js'`.

- [ ] **Step 3: Write the implementation**

Crie `src/modules/auth/auth.refresh-token.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

// SHA-256 is enough here, and scrypt would be wrong: the secret is 32 random bytes, not a password.
// There is no dictionary to slow down, and the database must never hold the token itself.
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function createRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");

  return { token, tokenHash: hashRefreshToken(token) };
}

export function refreshTokenExpiration(now: Date, ttlDays: number): Date {
  return new Date(now.getTime() + ttlDays * MILLISECONDS_PER_DAY);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/auth/auth.refresh-token.test.ts`
Expected: PASS, seis casos.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npx prettier --check .
git add src/modules/auth/auth.refresh-token.ts tests/modules/auth/auth.refresh-token.test.ts
git commit -m "feat(auth): generate refresh tokens and store only their hash"
```

### Task 7: Access token

**Files:**

- Modify: `package.json` (dependência `@fastify/jwt`)
- Create: `src/modules/auth/auth.jwt.ts`
- Test: `tests/modules/auth/auth.jwt.test.ts`

**Interfaces:**

- Consumes: `Env` da Task 3.
- Produces: `registerAccessToken(app: FastifyInstance, options: { secret: string; ttlMinutes: number }): Promise<void>`, `signAccessToken(app: FastifyInstance, userId: string): string`, `verifyAccessToken(app: FastifyInstance, token: string): AccessTokenPayload | null`, com `AccessTokenPayload = { sub: string }`.

- [ ] **Step 1: Install the dependency**

```bash
npm install @fastify/jwt
```

Confirme que ela caiu em `dependencies`, e não em `devDependencies`.

- [ ] **Step 2: Write the failing test**

Crie `tests/modules/auth/auth.jwt.test.ts`:

```ts
import fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerAccessToken, signAccessToken, verifyAccessToken } from "../../../src/modules/auth/auth.jwt.js";

const SECRET = "a-secret-long-enough-to-be-taken-seriously";
const USER_ID = "0199a1f0-0000-7000-8000-000000000001";

async function appWithAccessToken() {
  const app = fastify();
  await registerAccessToken(app, { secret: SECRET, ttlMinutes: 15 });
  await app.ready();

  return app;
}

describe("access token", () => {
  it("carries the user id and nothing else", async () => {
    const app = await appWithAccessToken();

    const payload = verifyAccessToken(app, signAccessToken(app, USER_ID));

    expect(payload?.sub).toBe(USER_ID);
    expect(Object.keys(payload ?? {}).sort()).toEqual(["exp", "iat", "sub"]);

    await app.close();
  });

  it("answers null for a token signed with another secret", async () => {
    const app = await appWithAccessToken();
    const stranger = fastify();
    await registerAccessToken(stranger, { secret: "another-secret-long-enough-to-be-used", ttlMinutes: 15 });
    await stranger.ready();

    expect(verifyAccessToken(app, signAccessToken(stranger, USER_ID))).toBeNull();

    await app.close();
    await stranger.close();
  });

  it("answers null for an expired token", async () => {
    const app = await appWithAccessToken();

    const expired = app.jwt.sign({ sub: USER_ID }, { expiresIn: "-1s" });

    expect(verifyAccessToken(app, expired)).toBeNull();

    await app.close();
  });

  it("answers null for a token that is not a token", async () => {
    const app = await appWithAccessToken();

    expect(verifyAccessToken(app, "garbage")).toBeNull();

    await app.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/modules/auth/auth.jwt.test.ts`
Expected: FAIL — `Cannot find module '../../../src/modules/auth/auth.jwt.js'`.

- [ ] **Step 4: Write the implementation**

Crie `src/modules/auth/auth.jwt.ts`:

```ts
import fastifyJwt from "@fastify/jwt";
import { FastifyInstance } from "fastify";

// The payload carries only the subject. Permissions travel from the database on every request, so
// putting them in here would make that freshness a lie.
export type AccessTokenPayload = { sub: string; iat: number; exp: number };

export async function registerAccessToken(
  app: FastifyInstance,
  options: { secret: string; ttlMinutes: number },
): Promise<void> {
  await app.register(fastifyJwt, {
    secret: options.secret,
    sign: { expiresIn: `${options.ttlMinutes}m` },
  });
}

export function signAccessToken(app: FastifyInstance, userId: string): string {
  return app.jwt.sign({ sub: userId });
}

export function verifyAccessToken(app: FastifyInstance, token: string): AccessTokenPayload | null {
  try {
    return app.jwt.verify<AccessTokenPayload>(token);
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/modules/auth/auth.jwt.test.ts`
Expected: PASS, quatro casos.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npx prettier --check .
git add package.json package-lock.json src/modules/auth/auth.jwt.ts tests/modules/auth/auth.jwt.test.ts
git commit -m "feat(auth): sign and verify short-lived access tokens"
```

### Task 8: Declaração de acesso na rota, cobrada no boot

A peça central da arquitetura. O controle é aplicado por dois hooks adicionados **dentro do escopo das rotas da aplicação**, e não na raiz: o Fastify encapsula hooks por escopo, então as rotas que o Swagger UI registra por conta própria ficam de fora sem precisar de allowlist.

**Files:**

- Create: `src/modules/auth/auth.access.ts`
- Test: `tests/modules/auth/auth.access.test.ts`

**Interfaces:**

- Consumes: `effectivePermissions`, `hasPermission` (Task 4), `verifyAccessToken` (Task 7), o enum `Permission` (Task 1).
- Produces:
  - `PUBLIC` e `AUTHENTICATED`, constantes de tipo `AccessRule = "public" | "authenticated" | Permission`.
  - `AuthenticatedUser = { id: string; permissions: Permission[] }`.
  - `AuthenticatedUserLoader = (userId: string) => Promise<AuthenticatedUser | null>`.
  - `applyAccessControl(app: FastifyInstance, loader: AuthenticatedUserLoader): void`.
  - `request.currentUser: AuthenticatedUser | undefined`, declarado no módulo `fastify`.

- [ ] **Step 1: Write the failing test**

Crie `tests/modules/auth/auth.access.test.ts`:

```ts
import fastify, { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { Permission } from "../../../src/generated/prisma/index.js";
import { registerAccessToken, signAccessToken } from "../../../src/modules/auth/auth.jwt.js";
import { applyAccessControl, AUTHENTICATED, AuthenticatedUser, PUBLIC } from "../../../src/modules/auth/auth.access.js";

const SECRET = "a-secret-long-enough-to-be-taken-seriously";
const USER: AuthenticatedUser = { id: "0199a1f0-0000-7000-8000-000000000001", permissions: [Permission.SALES_READ] };

async function appWithRoutes(register: (scope: FastifyInstance) => void, user: AuthenticatedUser | null = USER) {
  const app = fastify();
  await registerAccessToken(app, { secret: SECRET, ttlMinutes: 15 });

  await app.register(async (scope) => {
    applyAccessControl(scope, async (userId) => (user !== null && user.id === userId ? user : null));
    register(scope);
  });

  await app.ready();

  return app;
}

const bearer = (app: FastifyInstance, userId = USER.id) => ({
  authorization: `Bearer ${signAccessToken(app, userId)}`,
});

describe("applyAccessControl", () => {
  it("refuses to register a route that declares no access", async () => {
    await expect(
      appWithRoutes((scope) => {
        scope.get("/forgotten", async () => ({ ok: true }));
      }),
    ).rejects.toThrow(/GET \/forgotten/);
  });

  it("lets a public route through without a token", async () => {
    const app = await appWithRoutes((scope) => {
      scope.get("/health", { config: { auth: PUBLIC } }, async () => ({ ok: true }));
    });

    expect((await app.inject({ method: "GET", url: "/v1/health" })).statusCode).toBe(200);

    await app.close();
  });

  it("answers 401 when an authenticated route gets no token", async () => {
    const app = await appWithRoutes((scope) => {
      scope.get("/me", { config: { auth: AUTHENTICATED } }, async () => ({ ok: true }));
    });

    expect((await app.inject({ method: "GET", url: "/v1/sessions/me" })).statusCode).toBe(401);

    await app.close();
  });

  it("answers 401 for a token that does not verify", async () => {
    const app = await appWithRoutes((scope) => {
      scope.get("/me", { config: { auth: AUTHENTICATED } }, async () => ({ ok: true }));
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/sessions/me",
      headers: { authorization: "Bearer garbage" },
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it("answers 401 when the token names a user who no longer answers", async () => {
    const app = await appWithRoutes((scope) => {
      scope.get("/me", { config: { auth: AUTHENTICATED } }, async () => ({ ok: true }));
    }, null);

    const response = await app.inject({ method: "GET", url: "/v1/sessions/me", headers: bearer(app) });

    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it("attaches the authenticated user to the request", async () => {
    const app = await appWithRoutes((scope) => {
      scope.get("/me", { config: { auth: AUTHENTICATED } }, async (request) => request.currentUser);
    });

    const response = await app.inject({ method: "GET", url: "/v1/sessions/me", headers: bearer(app) });

    expect(response.json()).toEqual(USER);

    await app.close();
  });

  it("lets a permission the user holds through", async () => {
    const app = await appWithRoutes((scope) => {
      scope.get("/sales", { config: { auth: Permission.SALES_READ } }, async () => ({ ok: true }));
    });

    expect((await app.inject({ method: "GET", url: "/v1/sales", headers: bearer(app) })).statusCode).toBe(200);

    await app.close();
  });

  it("answers 403 for a permission the user does not hold", async () => {
    const app = await appWithRoutes((scope) => {
      scope.post("/sales", { config: { auth: Permission.SALES_CREATE } }, async () => ({ ok: true }));
    });

    expect((await app.inject({ method: "POST", url: "/v1/sales", headers: bearer(app) })).statusCode).toBe(403);

    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/auth/auth.access.test.ts`
Expected: FAIL — `Cannot find module '../../../src/modules/auth/auth.access.js'`.

- [ ] **Step 3: Write the implementation**

Crie `src/modules/auth/auth.access.ts`:

```ts
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Permission } from "../../generated/prisma/index.js";
import { verifyAccessToken } from "./auth.jwt.js";
import { hasPermission } from "./auth.permissions.js";

export const PUBLIC = "public" as const;
export const AUTHENTICATED = "authenticated" as const;

export type AccessRule = typeof PUBLIC | typeof AUTHENTICATED | Permission;

export type AuthenticatedUser = { id: string; permissions: Permission[] };
export type AuthenticatedUserLoader = (userId: string) => Promise<AuthenticatedUser | null>;

declare module "fastify" {
  interface FastifyContextConfig {
    auth?: AccessRule;
  }

  interface FastifyRequest {
    currentUser?: AuthenticatedUser;
  }
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;

  if (header === undefined || !header.startsWith("Bearer ")) return null;

  const token = header.slice("Bearer ".length).trim();

  return token === "" ? null : token;
}

const unauthorized = (reply: FastifyReply) => reply.code(401).send({ message: "Authentication required." });
const forbidden = (reply: FastifyReply) => reply.code(403).send({ message: "Permission denied." });

// Hooks are scoped in Fastify: adding these inside the plugin that registers the application's
// routes leaves the documentation routes, registered elsewhere, untouched.
export function applyAccessControl(app: FastifyInstance, loadUser: AuthenticatedUserLoader): void {
  // A route with no declared access is a route nobody decided about. Failing at registration turns
  // that into an application that does not start, instead of an endpoint quietly open in production.
  app.addHook("onRoute", (route) => {
    if (route.config?.auth === undefined) {
      throw new Error(
        `Route ${route.method} ${route.url} does not declare its access. Use PUBLIC, AUTHENTICATED or a Permission.`,
      );
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    const rule = request.routeOptions.config.auth;

    if (rule === PUBLIC) return;

    const token = bearerToken(request);

    if (token === null) return unauthorized(reply);

    const payload = verifyAccessToken(request.server, token);

    if (payload === null) return unauthorized(reply);

    const user = await loadUser(payload.sub);

    if (user === null) return unauthorized(reply);

    request.currentUser = user;

    if (rule === AUTHENTICATED) return;

    if (!hasPermission(user.permissions, rule as Permission)) return forbidden(reply);
  });
}
```

`route.method` pode ser um array quando a rota declara vários métodos; a mensagem do erro imprime o que o Fastify entregar, e isso basta para localizar a rota.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/auth/auth.access.test.ts`
Expected: PASS, oito casos.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npx prettier --check .
git add src/modules/auth/auth.access.ts tests/modules/auth/auth.access.test.ts
git commit -m "feat(auth): decide access from the rule each route declares"
```

### Task 9: Repositório e serviço de sessão

**Files:**

- Create: `src/modules/auth/auth.repository.ts`
- Create: `src/modules/auth/auth.service.ts`
- Test: `tests/modules/auth/auth.service.integration.test.ts`

**Interfaces:**

- Consumes: `prisma` (`src/lib/prisma.ts`), `hashPassword`/`verifyPassword` (Task 5), `createRefreshToken`/`hashRefreshToken`/`refreshTokenExpiration` (Task 6), `effectivePermissions` (Task 4).
- Produces, em `auth.repository.ts`:
  - `findUserByUsername(username: string)` e `findUserById(id: string)`, ambos devolvendo o usuário com `role` incluído ou `null`.
  - `loadAuthenticatedUser(userId: string): Promise<AuthenticatedUser | null>` — devolve `null` para usuário inexistente ou inativo.
  - `insertRefreshToken(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<{ id: string }>`.
  - `findRefreshTokenByHash(tokenHash: string)`.
  - `markRefreshTokenReplaced(id: string, replacedById: string): Promise<void>`.
  - `revokeRefreshToken(id: string): Promise<void>`.
  - `revokeAllRefreshTokens(userId: string): Promise<void>`.
- Produces, em `auth.service.ts`:
  - `type SessionTokens = { accessToken: string; refreshToken: string }`.
  - `login(app, input: { username: string; password: string }): Promise<SessionTokens | null>`.
  - `refreshSession(app, refreshToken: string): Promise<SessionTokens | null>`.
  - `logout(refreshToken: string): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Crie `tests/modules/auth/auth.service.integration.test.ts`:

```ts
import fastify, { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerAccessToken, verifyAccessToken } from "../../../src/modules/auth/auth.jwt.js";
import { hashPassword } from "../../../src/modules/auth/auth.password.js";
import { hashRefreshToken } from "../../../src/modules/auth/auth.refresh-token.js";
import { login, logout, refreshSession } from "../../../src/modules/auth/auth.service.js";
import { loadAuthenticatedUser, revokeAllRefreshTokens } from "../../../src/modules/auth/auth.repository.js";
import { resetDatabase, testPrisma } from "../../support/database.js";

const SECRET = "a-secret-long-enough-to-be-taken-seriously";
const PASSWORD = "correct horse battery";

let app: FastifyInstance;

async function createUser(overrides: { isActive?: boolean } = {}) {
  return testPrisma.user.create({
    data: {
      name: "Test Person",
      username: "tester",
      passwordHash: await hashPassword(PASSWORD),
      isActive: overrides.isActive ?? true,
    },
  });
}

beforeEach(async () => {
  app = fastify();
  await registerAccessToken(app, { secret: SECRET, ttlMinutes: 15 });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("login", () => {
  it("answers a token pair for the right credentials", async () => {
    const user = await createUser();

    const tokens = await login(app, { username: "tester", password: PASSWORD });

    expect(tokens).not.toBeNull();
    expect(verifyAccessToken(app, tokens!.accessToken)?.sub).toBe(user.id);
  });

  it("stores only the hash of the refresh token", async () => {
    await createUser();

    const tokens = await login(app, { username: "tester", password: PASSWORD });
    const stored = await testPrisma.refreshToken.findMany();

    expect(stored).toHaveLength(1);
    expect(stored[0].tokenHash).toBe(hashRefreshToken(tokens!.refreshToken));
    expect(stored[0].tokenHash).not.toBe(tokens!.refreshToken);
  });

  it("answers null for the wrong password", async () => {
    await createUser();

    expect(await login(app, { username: "tester", password: "wrong" })).toBeNull();
  });

  it("answers null for a username nobody has", async () => {
    expect(await login(app, { username: "ghost", password: PASSWORD })).toBeNull();
  });

  it("answers null for a deactivated user", async () => {
    await createUser({ isActive: false });

    expect(await login(app, { username: "tester", password: PASSWORD })).toBeNull();
  });
});

describe("refreshSession", () => {
  it("answers a new pair and revokes the one presented", async () => {
    await createUser();
    const first = await login(app, { username: "tester", password: PASSWORD });

    const second = await refreshSession(app, first!.refreshToken);

    expect(second).not.toBeNull();
    expect(second!.refreshToken).not.toBe(first!.refreshToken);

    const previous = await testPrisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(first!.refreshToken) },
    });

    expect(previous?.revokedAt).not.toBeNull();
    expect(previous?.replacedById).not.toBeNull();
  });

  it("revokes the whole chain when a rotated token comes back", async () => {
    await createUser();
    const first = await login(app, { username: "tester", password: PASSWORD });
    const second = await refreshSession(app, first!.refreshToken);

    expect(await refreshSession(app, first!.refreshToken)).toBeNull();

    const survivors = await testPrisma.refreshToken.findMany({ where: { revokedAt: null } });

    expect(survivors).toHaveLength(0);
    expect(await refreshSession(app, second!.refreshToken)).toBeNull();
  });

  it("answers null for a refresh token nobody issued", async () => {
    expect(await refreshSession(app, "a-token-that-was-never-issued")).toBeNull();
  });

  it("answers null for an expired refresh token", async () => {
    const user = await createUser();
    const tokens = await login(app, { username: "tester", password: PASSWORD });

    await testPrisma.refreshToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date("2020-01-01T00:00:00.000Z") },
    });

    expect(await refreshSession(app, tokens!.refreshToken)).toBeNull();
  });
});

describe("logout", () => {
  it("revokes the token presented", async () => {
    await createUser();
    const tokens = await login(app, { username: "tester", password: PASSWORD });

    await logout(tokens!.refreshToken);

    expect(await refreshSession(app, tokens!.refreshToken)).toBeNull();
  });
});

describe("loadAuthenticatedUser", () => {
  it("answers the effective permission of an active user", async () => {
    const role = await testPrisma.role.create({ data: { name: "Seller", permissions: ["SALES_READ"] } });
    const user = await testPrisma.user.create({
      data: {
        name: "Test Person",
        username: "seller",
        passwordHash: await hashPassword(PASSWORD),
        roleId: role.id,
        extraPermissions: ["REPORTS_READ"],
      },
    });

    const authenticated = await loadAuthenticatedUser(user.id);

    expect(authenticated?.permissions.sort()).toEqual(["REPORTS_READ", "SALES_READ"]);
  });

  it("answers null for a deactivated user", async () => {
    const user = await createUser({ isActive: false });

    expect(await loadAuthenticatedUser(user.id)).toBeNull();
  });
});

describe("revokeAllRefreshTokens", () => {
  it("ends every session the user had", async () => {
    const user = await createUser();
    const tokens = await login(app, { username: "tester", password: PASSWORD });

    await revokeAllRefreshTokens(user.id);

    expect(await refreshSession(app, tokens!.refreshToken)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — `Cannot find module '../../../src/modules/auth/auth.repository.js'`.

- [ ] **Step 3: Write the repository**

Crie `src/modules/auth/auth.repository.ts`:

```ts
import { prisma } from "../../lib/prisma.js";
import { AuthenticatedUser } from "./auth.access.js";
import { effectivePermissions } from "./auth.permissions.js";

export function findUserByUsername(username: string) {
  return prisma.user.findUnique({ where: { username }, include: { role: true } });
}

export function findUserById(id: string) {
  return prisma.user.findUnique({ where: { id }, include: { role: true } });
}

// The one query that crosses user and role. It answers an authentication question, which is why it
// lives here and not in the users module.
export async function loadAuthenticatedUser(userId: string): Promise<AuthenticatedUser | null> {
  const user = await findUserById(userId);

  if (user === null || !user.isActive) return null;

  return {
    id: user.id,
    permissions: effectivePermissions({
      rolePermissions: user.role?.permissions ?? [],
      extraPermissions: user.extraPermissions,
    }),
  };
}

export function insertRefreshToken(input: { userId: string; tokenHash: string; expiresAt: Date }) {
  return prisma.refreshToken.create({ data: input });
}

export function findRefreshTokenByHash(tokenHash: string) {
  return prisma.refreshToken.findUnique({ where: { tokenHash } });
}

export async function markRefreshTokenReplaced(id: string, replacedById: string): Promise<void> {
  await prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date(), replacedById } });
}

export async function revokeRefreshToken(id: string): Promise<void> {
  await prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
```

- [ ] **Step 4: Write the service**

Crie `src/modules/auth/auth.service.ts`:

```ts
import { FastifyInstance } from "fastify";
import { loadEnv } from "../../lib/env.js";
import { signAccessToken } from "./auth.jwt.js";
import { verifyPassword } from "./auth.password.js";
import { createRefreshToken, hashRefreshToken, refreshTokenExpiration } from "./auth.refresh-token.js";
import {
  findRefreshTokenByHash,
  findUserByUsername,
  insertRefreshToken,
  markRefreshTokenReplaced,
  revokeAllRefreshTokens,
  revokeRefreshToken,
} from "./auth.repository.js";

export type SessionTokens = { accessToken: string; refreshToken: string };

async function issueTokens(app: FastifyInstance, userId: string): Promise<SessionTokens & { refreshTokenId: string }> {
  const env = loadEnv();
  const { token, tokenHash } = createRefreshToken();

  const stored = await insertRefreshToken({
    userId,
    tokenHash,
    expiresAt: refreshTokenExpiration(new Date(), env.REFRESH_TOKEN_TTL_DAYS),
  });

  return { accessToken: signAccessToken(app, userId), refreshToken: token, refreshTokenId: stored.id };
}

export async function login(
  app: FastifyInstance,
  input: { username: string; password: string },
): Promise<SessionTokens | null> {
  const user = await findUserByUsername(input.username);

  // The password is verified even when the user does not exist, so that a missing username and a
  // wrong password take the same time to answer.
  const digest = user?.passwordHash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAA";
  const matches = await verifyPassword(input.password, digest);

  if (user === null || !user.isActive || !matches) return null;

  const { accessToken, refreshToken } = await issueTokens(app, user.id);

  return { accessToken, refreshToken };
}

export async function refreshSession(app: FastifyInstance, refreshToken: string): Promise<SessionTokens | null> {
  const stored = await findRefreshTokenByHash(hashRefreshToken(refreshToken));

  if (stored === null) return null;

  // A token that was already rotated coming back means two parties hold the same credential. The
  // safe reading is theft, so the whole chain goes down.
  if (stored.revokedAt !== null) {
    await revokeAllRefreshTokens(stored.userId);
    return null;
  }

  if (stored.expiresAt.getTime() <= Date.now()) return null;

  const issued = await issueTokens(app, stored.userId);

  await markRefreshTokenReplaced(stored.id, issued.refreshTokenId);

  return { accessToken: issued.accessToken, refreshToken: issued.refreshToken };
}

export async function logout(refreshToken: string): Promise<void> {
  const stored = await findRefreshTokenByHash(hashRefreshToken(refreshToken));

  if (stored === null || stored.revokedAt !== null) return;

  await revokeRefreshToken(stored.id);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:integration`
Expected: PASS, treze casos neste arquivo.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npx prettier --check .
git add src/modules/auth tests/modules/auth
git commit -m "feat(auth): issue, rotate and revoke sessions"
```

### Task 10: Rotas de sessão e `/v1/sessions/me`, com a API fechada

Esta é a tarefa em que a API deixa de ser aberta: `applyAccessControl` entra no escopo de `routes.ts`, e a partir dela toda rota nova é obrigada a declarar seu acesso.

**Files:**

- Create: `src/modules/auth/auth.schemas.ts`
- Create: `src/modules/auth/auth.routes.ts`
- Modify: `src/routes.ts`
- Modify: `src/app.ts`
- Test: `tests/modules/auth/auth.routes.integration.test.ts`

**Interfaces:**

- Consumes: `login`, `refreshSession`, `logout` (Task 9), `applyAccessControl`, `PUBLIC`, `AUTHENTICATED` (Task 8), `registerAccessToken` (Task 7), `loadAuthenticatedUser` (Task 9).
- Produces: as rotas `POST /sessions/signin`, `POST /sessions/refresh`, `POST /sessions/signout`, `GET /sessions/me`, `GET /health`, todas servidas sob o prefixo `/v1`.

- [ ] **Step 1: Write the failing test**

Crie `tests/modules/auth/auth.routes.integration.test.ts`:

```ts
import { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../../src/modules/auth/auth.password.js";
import { resetDatabase, testPrisma } from "../../support/database.js";
import { startTestApp } from "../../support/app.js";

const PASSWORD = "correct horse battery";

let app: FastifyInstance;

async function createUser() {
  const role = await testPrisma.role.create({ data: { name: "Seller", permissions: ["SALES_READ"] } });

  return testPrisma.user.create({
    data: {
      name: "Test Person",
      username: "tester",
      passwordHash: await hashPassword(PASSWORD),
      roleId: role.id,
      extraPermissions: ["REPORTS_READ"],
    },
  });
}

async function loginAs(username = "tester", password = PASSWORD) {
  const response = await app.inject({ method: "POST", url: "/v1/sessions/signin", payload: { username, password } });

  return { statusCode: response.statusCode, body: response.json() };
}

// A fresh application per case, not per file: the login rate limiter keeps its counters in the
// instance, and authenticateAs signs in with the same username in every case.
beforeEach(async () => {
  app = await startTestApp();
});

afterEach(async () => {
  await app.close();
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("POST /v1/sessions/signin", () => {
  it("answers 200 and a token pair for the right credentials", async () => {
    await createUser();

    const { statusCode, body } = await loginAs();

    expect(statusCode).toBe(200);
    expect(typeof body.accessToken).toBe("string");
    expect(typeof body.refreshToken).toBe("string");
  });

  it("answers 401 with the same message for a wrong password and for an unknown username", async () => {
    await createUser();

    const wrongPassword = await loginAs("tester", "wrong");
    const unknownUser = await loginAs("ghost", PASSWORD);

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    expect(wrongPassword.body).toEqual(unknownUser.body);
  });

  it("answers 400 when the body does not carry a username", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/sessions/signin", payload: { password: PASSWORD } });

    expect(response.statusCode).toBe(400);
  });
});

describe("POST /v1/sessions/refresh", () => {
  it("answers a new pair", async () => {
    await createUser();
    const { body } = await loginAs();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions/refresh",
      payload: { refreshToken: body.refreshToken },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().refreshToken).not.toBe(body.refreshToken);
  });

  it("answers 401 for a token that was already rotated", async () => {
    await createUser();
    const { body } = await loginAs();
    await app.inject({ method: "POST", url: "/v1/sessions/refresh", payload: { refreshToken: body.refreshToken } });

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions/refresh",
      payload: { refreshToken: body.refreshToken },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("POST /v1/sessions/signout", () => {
  it("revokes the refresh token presented", async () => {
    await createUser();
    const { body } = await loginAs();

    const signout = await app.inject({
      method: "POST",
      url: "/v1/sessions/signout",
      headers: { authorization: `Bearer ${body.accessToken}` },
      payload: { refreshToken: body.refreshToken },
    });

    const refresh = await app.inject({
      method: "POST",
      url: "/v1/sessions/refresh",
      payload: { refreshToken: body.refreshToken },
    });

    expect(signout.statusCode).toBe(204);
    expect(refresh.statusCode).toBe(401);
  });

  it("answers 401 without an access token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions/signout",
      payload: { refreshToken: "whatever" },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("GET /v1/sessions/me", () => {
  it("answers the current user and the permission the role and the extras add up to", async () => {
    const user = await createUser();
    const { body } = await loginAs();

    const response = await app.inject({
      method: "GET",
      url: "/v1/sessions/me",
      headers: { authorization: `Bearer ${body.accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: user.id,
      name: "Test Person",
      username: "tester",
      roleId: user.roleId,
      permissions: ["SALES_READ", "REPORTS_READ"],
    });
  });

  it("answers 401 once the user is deactivated, on the next request", async () => {
    const user = await createUser();
    const { body } = await loginAs();

    await testPrisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    const response = await app.inject({
      method: "GET",
      url: "/v1/sessions/me",
      headers: { authorization: `Bearer ${body.accessToken}` },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("GET /v1/health", () => {
  it("answers without a token", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/health" })).statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — `POST /v1/sessions/signin` responde 404, porque a rota não existe.

- [ ] **Step 3: Write the schemas**

Crie `src/modules/auth/auth.schemas.ts`:

```ts
import { z } from "zod";
import { Permission } from "../../generated/prisma/index.js";

export const loginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});

export const sessionTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const messageSchema = z.object({ message: z.string() });

export const currentUserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  username: z.string(),
  roleId: z.uuid().nullable(),
  permissions: z.array(z.enum(Permission)),
});
```

- [ ] **Step 4: Write the routes**

Crie `src/modules/auth/auth.routes.ts`:

```ts
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { AUTHENTICATED, PUBLIC } from "./auth.access.js";
import { findUserById } from "./auth.repository.js";
import { login, logout, refreshSession } from "./auth.service.js";
import {
  currentUserSchema,
  loginBodySchema,
  messageSchema,
  refreshBodySchema,
  sessionTokensSchema,
} from "./auth.schemas.js";

const INVALID_CREDENTIALS = { message: "Invalid credentials." };

export default async function authRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    "/sessions/signin",
    {
      config: { auth: PUBLIC },
      schema: {
        tags: ["auth"],
        summary: "Autentica e devolve o par de tokens",
        body: loginBodySchema,
        response: { 200: sessionTokensSchema, 401: messageSchema },
      },
    },
    async (request, reply) => {
      const tokens = await login(app, request.body);

      // The same answer for an unknown username and for a wrong password: telling them apart would
      // turn the login route into a directory of who exists.
      if (tokens === null) return reply.code(401).send(INVALID_CREDENTIALS);

      return reply.send(tokens);
    },
  );

  typed.post(
    "/sessions/refresh",
    {
      config: { auth: PUBLIC },
      schema: {
        tags: ["auth"],
        summary: "Rotaciona o par de tokens",
        body: refreshBodySchema,
        response: { 200: sessionTokensSchema, 401: messageSchema },
      },
    },
    async (request, reply) => {
      const tokens = await refreshSession(app, request.body.refreshToken);

      if (tokens === null) return reply.code(401).send(INVALID_CREDENTIALS);

      return reply.send(tokens);
    },
  );

  typed.post(
    "/sessions/signout",
    {
      config: { auth: AUTHENTICATED },
      schema: {
        tags: ["auth"],
        summary: "Encerra a sessão, revogando o refresh token",
        body: refreshBodySchema,
        response: { 204: z.void() },
      },
    },
    async (request, reply) => {
      await logout(request.body.refreshToken);

      return reply.code(204).send();
    },
  );

  typed.get(
    "/sessions/me",
    {
      config: { auth: AUTHENTICATED },
      schema: {
        tags: ["auth"],
        summary: "Usuário atual e suas permissões efetivas",
        response: { 200: currentUserSchema },
      },
    },
    async (request, reply) => {
      const current = request.currentUser!;
      const user = await findUserById(current.id);

      return reply.send({
        id: current.id,
        name: user!.name,
        username: user!.username,
        roleId: user!.roleId,
        permissions: current.permissions,
      });
    },
  );
}
```

Acrescente `import { z } from "zod";` ao topo do arquivo — o `204` usa `z.void()`.

- [ ] **Step 5: Wire the access control into the application**

Substitua `src/routes.ts` inteiro por:

```ts
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { applyAccessControl, PUBLIC } from "./modules/auth/auth.access.js";
import { loadAuthenticatedUser } from "./modules/auth/auth.repository.js";
import authRoutes from "./modules/auth/auth.routes.js";

export default async function (app: FastifyInstance) {
  applyAccessControl(app, loadAuthenticatedUser);

  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/health",
    {
      config: { auth: PUBLIC },
      schema: { tags: ["health"], summary: "Saúde do serviço", response: { 200: z.object({ status: z.string() }) } },
    },
    async () => ({ status: "ok" }),
  );

  await app.register(authRoutes);
}
```

Em `src/app.ts`, registre o access token antes das rotas — logo depois do `fastifySwaggerUi`:

```ts
await registerAccessToken(app, { secret: env.JWT_SECRET, ttlMinutes: env.ACCESS_TOKEN_TTL_MINUTES });
```

com `import { registerAccessToken } from "./modules/auth/auth.jwt.js";` no topo.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:integration`
Expected: PASS, dez casos neste arquivo.

- [ ] **Step 7: Commit**

```bash
npm run typecheck && npx prettier --check .
git add src tests
git commit -m "feat(auth): close the API behind sessions and expose the current user"
```

### Task 11: CORS por ambiente e limite de tentativas no login

**Files:**

- Modify: `package.json` (dependência `@fastify/rate-limit`)
- Modify: `src/app.ts`
- Modify: `src/modules/auth/auth.routes.ts`
- Test: `tests/modules/auth/auth.rate-limit.integration.test.ts`

**Interfaces:**

- Consumes: `Env.CORS_ORIGINS` (Task 3), as rotas da Task 10.
- Produces: `POST /v1/sessions/signin` responde `429` depois de cinco tentativas por minuto para o mesmo par IP e username.

- [ ] **Step 1: Install the dependency**

```bash
npm install @fastify/rate-limit
```

- [ ] **Step 2: Write the failing test**

Crie `tests/modules/auth/auth.rate-limit.integration.test.ts`:

```ts
import { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDatabase, testPrisma } from "../../support/database.js";
import { startTestApp } from "../../support/app.js";

let app: FastifyInstance;

const attemptLogin = (username: string) =>
  app.inject({ method: "POST", url: "/v1/sessions/signin", payload: { username, password: "wrong" } });

// A fresh application per case, not per file: the login rate limiter keeps its counters in the
// instance, and authenticateAs signs in with the same username in every case.
beforeEach(async () => {
  app = await startTestApp();
});

afterEach(async () => {
  await app.close();
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("POST /v1/sessions/signin rate limit", () => {
  it("answers 429 once the attempts for one username run out", async () => {
    const codes: number[] = [];

    for (let attempt = 0; attempt < 6; attempt += 1) {
      codes.push((await attemptLogin("target")).statusCode);
    }

    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes[5]).toBe(429);
  });

  it("does not spend another username's attempts", async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) await attemptLogin("target");

    expect((await attemptLogin("someone-else")).statusCode).toBe(401);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:integration -- tests/modules/auth/auth.rate-limit.integration.test.ts`
Expected: FAIL — a sexta tentativa responde 401, não 429.

- [ ] **Step 4: Register the plugin and read the origins from the environment**

Em `src/app.ts`, troque o registro do CORS e acrescente o do rate limit:

```ts
await app.register(fastifyCors, {
  origin: env.CORS_ORIGINS,
  methods: ["GET", "POST", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

await app.register(fastifyRateLimit, { global: false });
```

com `import fastifyRateLimit from "@fastify/rate-limit";` no topo. `global: false` deixa o limite valer só onde a rota pedir.

- [ ] **Step 5: Limit the login route**

Em `src/modules/auth/auth.routes.ts`, acrescente a configuração à rota `POST /sessions/signin`, ao lado de `auth: PUBLIC`:

```ts
config: {
  auth: PUBLIC,
  rateLimit: {
    max: 5,
    timeWindow: "1 minute",
    // The hook runs after the body is parsed so the key can include the username: limiting by IP
    // alone lets one office share the budget, and by username alone lets one IP sweep every account.
    hook: "preHandler",
    keyGenerator: (request: FastifyRequest<{ Body: { username?: string } }>) =>
      `${request.ip}:${request.body?.username ?? ""}`,
  },
},
```

Acrescente `FastifyRequest` ao import de `fastify` no arquivo.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:integration`
Expected: PASS. Os testes de `auth.routes.integration.test.ts` continuam passando: nenhum deles faz mais de cinco tentativas com o mesmo username.

- [ ] **Step 7: Commit**

```bash
npm run typecheck && npx prettier --check .
git add package.json package-lock.json src tests
git commit -m "feat(auth): limit login attempts and read the allowed origins from the environment"
```

### Task 12: Inventário de rotas como snapshot

Fecha a Fase 1. Afrouxar uma permissão passa a aparecer no diff do PR.

**Files:**

- Test: `tests/routes-inventory.integration.test.ts`

**Interfaces:**

- Consumes: `startTestApp` (Task 2) e todas as rotas registradas até aqui.
- Produces: nada em `src`.

- [ ] **Step 1: Write the test**

Crie `tests/routes-inventory.integration.test.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { startTestApp } from "./support/app.js";
import { testPrisma } from "./support/database.js";

const app = await startTestApp();

afterAll(async () => {
  await app.close();
  await testPrisma.$disconnect();
});

// Every route and the rule it declares, in one readable list. Loosening a permission stops being a
// one-word change buried in a module and starts being a line in the diff of this snapshot.
describe("routes inventory", () => {
  it("matches the recorded access of every route", () => {
    const inventory = app
      .printRoutes({ includeHooks: false, commonPrefix: false })
      .split("\n")
      .filter((line) => line.includes("("));

    expect(inventory.join("\n")).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run the test to create the snapshot**

Run: `npm run test:integration -- tests/routes-inventory.integration.test.ts`
Expected: PASS, com `1 snapshot written`.

- [ ] **Step 3: Read the snapshot**

Abra `tests/__snapshots__/routes-inventory.integration.test.ts.snap` e confira à mão que cada rota da Fase 1 aparece com o acesso que o spec manda: `/v1/sessions/signin` e `/v1/sessions/refresh` públicas, `/v1/sessions/signout` e `/v1/sessions/me` autenticadas, `/v1/health` pública.

- [ ] **Step 4: Commit**

```bash
npx prettier --check .
git add tests
git commit -m "test(routes): record the declared access of every route"
```

- [ ] **Step 5: Open the Fase 1 pull request**

```bash
git push -u origin feat/auth-foundation
```

Corpo do PR, exatamente neste formato:

```
## What changed
- roles, users and refresh tokens tables — model the access data under the table convention
- effective permission function — single source of what a user may do
- scrypt password hashing — store credentials without a native dependency
- access and refresh tokens — short-lived JWT plus a rotating opaque token with reuse detection
- per-route access declaration — the application refuses to start with an undeclared route
- versioned route prefix — every route served under /v1, applied in one place
- session routes and /v1/sessions/me — signin, refresh, signout and the current user
- login rate limit and environment-driven CORS — close brute force and the wildcard origin
- integration test setup — run the built application against an isolated database schema

## Dependencies
- @fastify/jwt@10.0.0 — sign and verify the access token
- @fastify/rate-limit@10.3.0 — limit login attempts
```

Confirme as versões instaladas com `npm ls @fastify/jwt @fastify/rate-limit` antes de abrir o PR.

---

# Fase 2 — administração de acesso

Branch: `feat/access-administration`, a partir da `main` já com a Fase 1 mesclada.

### Task 13: Módulo de papéis

**Files:**

- Create: `src/modules/roles/roles.repository.ts`
- Create: `src/modules/roles/roles.schemas.ts`
- Create: `src/modules/roles/roles.routes.ts`
- Modify: `src/routes.ts`
- Test: `tests/modules/roles/roles.routes.integration.test.ts`

**Interfaces:**

- Consumes: `Permission` (Task 1), `prisma`, o controle de acesso da Task 8, e o helper de autenticação dos testes.
- Produces: `GET /v1/roles`, `POST /v1/roles`, `PATCH /v1/roles/:id`, `DELETE /v1/roles/:id`, e `authenticateAs(app, permissions)` em `tests/support/app.ts`.

- [ ] **Step 1: Extend the test helper**

Acrescente a `tests/support/app.ts`:

```ts
import { Permission } from "../../src/generated/prisma/index.js";
import { hashPassword } from "../../src/modules/auth/auth.password.js";
import { testPrisma } from "./database.js";

// Creates a user holding exactly the permissions the test needs and logs in as that user. Tests
// that need a permission say so; nothing is granted by accident.
export async function authenticateAs(
  app: FastifyInstance,
  permissions: Permission[],
  username = "tester",
): Promise<{ userId: string; headers: { authorization: string } }> {
  const user = await testPrisma.user.create({
    data: {
      name: "Test Person",
      username,
      passwordHash: await hashPassword("correct horse battery"),
      extraPermissions: permissions,
    },
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/sessions/signin",
    payload: { username, password: "correct horse battery" },
  });

  return { userId: user.id, headers: { authorization: `Bearer ${response.json().accessToken}` } };
}
```

- [ ] **Step 2: Write the failing test**

Crie `tests/modules/roles/roles.routes.integration.test.ts`:

```ts
import { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Permission } from "../../../src/generated/prisma/index.js";
import { authenticateAs, startTestApp } from "../../support/app.js";
import { resetDatabase, testPrisma } from "../../support/database.js";

let app: FastifyInstance;

// A fresh application per case, not per file: the login rate limiter keeps its counters in the
// instance, and authenticateAs signs in with the same username in every case.
beforeEach(async () => {
  app = await startTestApp();
});

afterEach(async () => {
  await app.close();
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("POST /v1/roles", () => {
  it("creates a role with the permissions it was given", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_CREATE]);

    const response = await app.inject({
      method: "POST",
      url: "/v1/roles",
      headers,
      payload: { name: "Seller", permissions: [Permission.SALES_READ, Permission.SALES_CREATE] },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: "Seller", permissions: ["SALES_READ", "SALES_CREATE"] });
  });

  it("answers 403 without ACCESS_CREATE", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_READ]);

    const response = await app.inject({
      method: "POST",
      url: "/v1/roles",
      headers,
      payload: { name: "Seller", permissions: [] },
    });

    expect(response.statusCode).toBe(403);
  });

  it("answers 409 for a name another role already has", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_CREATE]);
    await testPrisma.role.create({ data: { name: "Seller", permissions: [] } });

    const response = await app.inject({
      method: "POST",
      url: "/v1/roles",
      headers,
      payload: { name: "Seller", permissions: [] },
    });

    expect(response.statusCode).toBe(409);
  });

  it("answers 400 for a permission that is not in the enum", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_CREATE]);

    const response = await app.inject({
      method: "POST",
      url: "/v1/roles",
      headers,
      payload: { name: "Seller", permissions: ["SALES_DESTROY"] },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("GET /v1/roles", () => {
  it("lists the roles in alphabetical order", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_READ]);
    await testPrisma.role.createMany({
      data: [
        { name: "Stocker", permissions: [] },
        { name: "Seller", permissions: [] },
      ],
    });

    const response = await app.inject({ method: "GET", url: "/v1/roles", headers });

    expect(response.json().map((role: { name: string }) => role.name)).toEqual(["Seller", "Stocker"]);
  });

  it("answers 401 without a token", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/roles" })).statusCode).toBe(401);
  });
});

describe("PATCH /v1/roles/:id", () => {
  it("replaces the permission package", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_UPDATE]);
    const role = await testPrisma.role.create({ data: { name: "Seller", permissions: ["SALES_READ"] } });

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/roles/${role.id}`,
      headers,
      payload: { permissions: [Permission.REPORTS_READ] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().permissions).toEqual(["REPORTS_READ"]);
  });

  it("answers 404 for a role that does not exist", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_UPDATE]);

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/roles/0199a1f0-0000-7000-8000-0000000000ff",
      headers,
      payload: { permissions: [] },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("DELETE /v1/roles/:id", () => {
  it("removes the role and leaves its users without inheritance", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_UPDATE]);
    const role = await testPrisma.role.create({ data: { name: "Seller", permissions: ["SALES_READ"] } });
    const user = await testPrisma.user.create({
      data: { name: "Someone", username: "someone", passwordHash: "x", roleId: role.id },
    });

    const response = await app.inject({ method: "DELETE", url: `/v1/roles/${role.id}`, headers });

    expect(response.statusCode).toBe(204);
    expect((await testPrisma.user.findUnique({ where: { id: user.id } }))?.roleId).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:integration -- tests/modules/roles`
Expected: FAIL — todas as rotas respondem 404.

- [ ] **Step 4: Write the repository**

Crie `src/modules/roles/roles.repository.ts`:

```ts
import { Permission } from "../../generated/prisma/index.js";
import { prisma } from "../../lib/prisma.js";

export function listRoles() {
  return prisma.role.findMany({ orderBy: { name: "asc" } });
}

export function findRoleById(id: string) {
  return prisma.role.findUnique({ where: { id } });
}

export function findRoleByName(name: string) {
  return prisma.role.findUnique({ where: { name } });
}

export function insertRole(input: { name: string; permissions: Permission[] }) {
  return prisma.role.create({ data: input });
}

export function updateRole(id: string, input: { name?: string; permissions?: Permission[] }) {
  return prisma.role.update({ where: { id }, data: input });
}

export async function deleteRole(id: string): Promise<void> {
  await prisma.role.delete({ where: { id } });
}
```

- [ ] **Step 5: Write the schemas**

Crie `src/modules/roles/roles.schemas.ts`:

```ts
import { z } from "zod";
import { Permission } from "../../generated/prisma/index.js";

export const roleSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  permissions: z.array(z.enum(Permission)),
});

export const createRoleBodySchema = z.object({
  name: z.string().min(1).max(60),
  permissions: z.array(z.enum(Permission)),
});

export const updateRoleBodySchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    permissions: z.array(z.enum(Permission)).optional(),
  })
  .refine((body) => body.name !== undefined || body.permissions !== undefined, {
    message: "Nothing to update.",
  });

export const roleIdParamsSchema = z.object({ id: z.uuid() });
```

- [ ] **Step 6: Write the routes**

Crie `src/modules/roles/roles.routes.ts`:

```ts
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { Permission } from "../../generated/prisma/index.js";
import { messageSchema } from "../auth/auth.schemas.js";
import { deleteRole, findRoleById, findRoleByName, insertRole, listRoles, updateRole } from "./roles.repository.js";
import { createRoleBodySchema, roleIdParamsSchema, roleSchema, updateRoleBodySchema } from "./roles.schemas.js";

export default async function rolesRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/roles",
    {
      config: { auth: Permission.ACCESS_READ },
      schema: { tags: ["roles"], summary: "Lista os papéis", response: { 200: z.array(roleSchema) } },
    },
    async (_request, reply) => reply.send(await listRoles()),
  );

  typed.post(
    "/roles",
    {
      config: { auth: Permission.ACCESS_CREATE },
      schema: {
        tags: ["roles"],
        summary: "Cria um papel",
        body: createRoleBodySchema,
        response: { 201: roleSchema, 409: messageSchema },
      },
    },
    async (request, reply) => {
      if ((await findRoleByName(request.body.name)) !== null) {
        return reply.code(409).send({ message: "A role with this name already exists." });
      }

      return reply.code(201).send(await insertRole(request.body));
    },
  );

  typed.patch(
    "/roles/:id",
    {
      config: { auth: Permission.ACCESS_UPDATE },
      schema: {
        tags: ["roles"],
        summary: "Edita o nome e o pacote de permissões",
        params: roleIdParamsSchema,
        body: updateRoleBodySchema,
        response: { 200: roleSchema, 404: messageSchema, 409: messageSchema },
      },
    },
    async (request, reply) => {
      if ((await findRoleById(request.params.id)) === null) {
        return reply.code(404).send({ message: "Role not found." });
      }

      if (request.body.name !== undefined) {
        const sameName = await findRoleByName(request.body.name);

        if (sameName !== null && sameName.id !== request.params.id) {
          return reply.code(409).send({ message: "A role with this name already exists." });
        }
      }

      return reply.send(await updateRole(request.params.id, request.body));
    },
  );

  typed.delete(
    "/roles/:id",
    {
      config: { auth: Permission.ACCESS_UPDATE },
      schema: {
        tags: ["roles"],
        summary: "Remove o papel; seus usuários ficam sem herança",
        params: roleIdParamsSchema,
        response: { 204: z.void(), 404: messageSchema },
      },
    },
    async (request, reply) => {
      if ((await findRoleById(request.params.id)) === null) {
        return reply.code(404).send({ message: "Role not found." });
      }

      await deleteRole(request.params.id);

      return reply.code(204).send();
    },
  );
}
```

Registre o módulo em `src/routes.ts`, depois de `authRoutes`:

```ts
await app.register(rolesRoutes);
```

com `import rolesRoutes from "./modules/roles/roles.routes.js";` no topo.

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test:integration`
Expected: PASS. O snapshot de rotas da Task 12 falha, porque quatro rotas novas entraram — confira as linhas novas e atualize com `npm run test:integration -- -u`.

- [ ] **Step 8: Commit**

```bash
npm run typecheck && npx prettier --check .
git add src tests
git commit -m "feat(roles): administer the named permission packages"
```

### Task 14: Módulo de usuários

**Files:**

- Create: `src/modules/users/users.repository.ts`
- Create: `src/modules/users/users.schemas.ts`
- Create: `src/modules/users/users.routes.ts`
- Modify: `src/routes.ts`
- Test: `tests/modules/users/users.routes.integration.test.ts`

**Interfaces:**

- Consumes: `hashPassword` (Task 5), `findUserById`, `findUserByUsername` e `revokeAllRefreshTokens` (Task 9), `effectivePermissions` (Task 4), `findRoleById` (Task 13).
- Produces: `GET /v1/users`, `POST /v1/users`, `GET /v1/users/:id`, `PATCH /v1/users/:id`.

- [ ] **Step 1: Write the failing test**

Crie `tests/modules/users/users.routes.integration.test.ts`:

```ts
import { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Permission } from "../../../src/generated/prisma/index.js";
import { authenticateAs, startTestApp } from "../../support/app.js";
import { resetDatabase, testPrisma } from "../../support/database.js";

let app: FastifyInstance;

// A fresh application per case, not per file: the login rate limiter keeps its counters in the
// instance, and authenticateAs signs in with the same username in every case.
beforeEach(async () => {
  app = await startTestApp();
});

afterEach(async () => {
  await app.close();
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("POST /v1/users", () => {
  it("creates a user and never answers the password back", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_CREATE], "admin");

    const response = await app.inject({
      method: "POST",
      url: "/v1/users",
      headers,
      payload: { name: "New Person", username: "newbie", password: "a-good-password" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: "New Person", username: "newbie", permissions: [] });
    expect(JSON.stringify(response.json())).not.toContain("a-good-password");
    expect(JSON.stringify(response.json())).not.toContain("passwordHash");
  });

  it("stores the password hashed", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_CREATE], "admin");

    await app.inject({
      method: "POST",
      url: "/v1/users",
      headers,
      payload: { name: "New Person", username: "newbie", password: "a-good-password" },
    });

    const stored = await testPrisma.user.findUnique({ where: { username: "newbie" } });

    expect(stored?.passwordHash).toMatch(/^scrypt\$/);
  });

  it("answers 409 for a username somebody already has", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_CREATE], "admin");

    const response = await app.inject({
      method: "POST",
      url: "/v1/users",
      headers,
      payload: { name: "Impostor", username: "admin", password: "a-good-password" },
    });

    expect(response.statusCode).toBe(409);
  });

  it("answers 400 for a password shorter than eight characters", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_CREATE], "admin");

    const response = await app.inject({
      method: "POST",
      url: "/v1/users",
      headers,
      payload: { name: "New Person", username: "newbie", password: "short" },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("GET /v1/users/:id", () => {
  it("answers the effective permission alongside the record", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_READ], "admin");
    const role = await testPrisma.role.create({ data: { name: "Seller", permissions: ["SALES_READ"] } });
    const user = await testPrisma.user.create({
      data: {
        name: "Someone",
        username: "someone",
        passwordHash: "x",
        roleId: role.id,
        extraPermissions: ["REPORTS_READ"],
      },
    });

    const response = await app.inject({ method: "GET", url: `/v1/users/${user.id}`, headers });

    expect(response.statusCode).toBe(200);
    expect(response.json().permissions.sort()).toEqual(["REPORTS_READ", "SALES_READ"]);
  });

  it("answers 404 for a user that does not exist", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_READ], "admin");

    const response = await app.inject({
      method: "GET",
      url: "/v1/users/0199a1f0-0000-7000-8000-0000000000ff",
      headers,
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("PATCH /v1/users/:id", () => {
  it("assigns a role", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_UPDATE], "admin");
    const role = await testPrisma.role.create({ data: { name: "Seller", permissions: ["SALES_READ"] } });
    const user = await testPrisma.user.create({
      data: { name: "Someone", username: "someone", passwordHash: "x" },
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/users/${user.id}`,
      headers,
      payload: { roleId: role.id },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().permissions).toEqual(["SALES_READ"]);
  });

  it("answers 404 for a role that does not exist", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_UPDATE], "admin");
    const user = await testPrisma.user.create({
      data: { name: "Someone", username: "someone", passwordHash: "x" },
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/users/${user.id}`,
      headers,
      payload: { roleId: "0199a1f0-0000-7000-8000-0000000000ff" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("ends every session of a user it deactivates", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_UPDATE], "admin");
    const target = await authenticateAs(app, [Permission.SALES_READ], "target");

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/users/${target.userId}`,
      headers,
      payload: { isActive: false },
    });

    const survivors = await testPrisma.refreshToken.count({ where: { userId: target.userId, revokedAt: null } });

    expect(response.statusCode).toBe(200);
    expect(survivors).toBe(0);
    expect((await app.inject({ method: "GET", url: "/v1/sessions/me", headers: target.headers })).statusCode).toBe(401);
  });

  it("answers 403 without ACCESS_UPDATE", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_READ], "admin");
    const user = await testPrisma.user.create({
      data: { name: "Someone", username: "someone", passwordHash: "x" },
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/users/${user.id}`,
      headers,
      payload: { isActive: false },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe("GET /v1/users", () => {
  it("lists users without any password material", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_READ], "admin");

    const response = await app.inject({ method: "GET", url: "/v1/users", headers });

    expect(response.statusCode).toBe(200);
    expect(JSON.stringify(response.json())).not.toContain("scrypt$");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- tests/modules/users`
Expected: FAIL — as rotas respondem 404.

- [ ] **Step 3: Write the repository**

Crie `src/modules/users/users.repository.ts`:

```ts
import { Permission } from "../../generated/prisma/index.js";
import { prisma } from "../../lib/prisma.js";

const WITH_ROLE = { include: { role: true } } as const;

// Reading one user by id or by username already lives in auth.repository.ts. A second copy here
// would be a second place to fix the day the query changes, so this module owns only what the
// cadastro needs on top of it.
export function listUsers() {
  return prisma.user.findMany({ ...WITH_ROLE, orderBy: { name: "asc" } });
}

export function insertUser(input: {
  name: string;
  username: string;
  passwordHash: string;
  roleId?: string | null;
  extraPermissions?: Permission[];
}) {
  return prisma.user.create({ data: input, ...WITH_ROLE });
}

export function updateUser(
  id: string,
  input: { name?: string; roleId?: string | null; extraPermissions?: Permission[]; isActive?: boolean },
) {
  return prisma.user.update({ where: { id }, data: input, ...WITH_ROLE });
}
```

A escrita do hash de senha **não** entra aqui: pela Decisão 4 a senha é assunto de `auth`, e a
rota que troca a própria senha vive em `auth.routes.ts`. Acrescente a
`src/modules/auth/auth.repository.ts`:

```ts
export async function updatePasswordHash(id: string, passwordHash: string): Promise<void> {
  await prisma.user.update({ where: { id }, data: { passwordHash } });
}
```

`users` já importa `findUserById` de `auth.repository.ts`; guardar a senha do outro lado inverteria
a seta e faria `auth` depender de `users`.

- [ ] **Step 4: Write the schemas**

Crie `src/modules/users/users.schemas.ts`:

```ts
import { z } from "zod";
import { Permission } from "../../generated/prisma/index.js";

// The response never carries passwordHash. Building it field by field, instead of spreading the
// record, is what keeps a future column from leaking by accident.
export const userSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  username: z.string(),
  roleId: z.uuid().nullable(),
  extraPermissions: z.array(z.enum(Permission)),
  permissions: z.array(z.enum(Permission)),
  isActive: z.boolean(),
});

export const createUserBodySchema = z.object({
  name: z.string().min(1).max(120),
  username: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9._-]+$/),
  password: z.string().min(8),
  roleId: z.uuid().nullable().optional(),
  extraPermissions: z.array(z.enum(Permission)).optional(),
});

export const updateUserBodySchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    roleId: z.uuid().nullable().optional(),
    extraPermissions: z.array(z.enum(Permission)).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update." });

export const userIdParamsSchema = z.object({ id: z.uuid() });
```

- [ ] **Step 5: Write the routes**

Crie `src/modules/users/users.routes.ts`:

```ts
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { Permission, Role, User } from "../../generated/prisma/index.js";
import { findUserById, findUserByUsername, revokeAllRefreshTokens } from "../auth/auth.repository.js";
import { hashPassword } from "../auth/auth.password.js";
import { effectivePermissions } from "../auth/auth.permissions.js";
import { messageSchema } from "../auth/auth.schemas.js";
import { findRoleById } from "../roles/roles.repository.js";
import { insertUser, listUsers, updateUser } from "./users.repository.js";
import { createUserBodySchema, updateUserBodySchema, userIdParamsSchema, userSchema } from "./users.schemas.js";

type UserWithRole = User & { role: Role | null };

function present(user: UserWithRole) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    roleId: user.roleId,
    extraPermissions: user.extraPermissions,
    permissions: effectivePermissions({
      rolePermissions: user.role?.permissions ?? [],
      extraPermissions: user.extraPermissions,
    }),
    isActive: user.isActive,
  };
}

export default async function usersRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/users",
    {
      config: { auth: Permission.ACCESS_READ },
      schema: { tags: ["users"], summary: "Lista os usuários", response: { 200: z.array(userSchema) } },
    },
    async (_request, reply) => reply.send((await listUsers()).map(present)),
  );

  typed.post(
    "/users",
    {
      config: { auth: Permission.ACCESS_CREATE },
      schema: {
        tags: ["users"],
        summary: "Cria um usuário",
        body: createUserBodySchema,
        response: { 201: userSchema, 404: messageSchema, 409: messageSchema },
      },
    },
    async (request, reply) => {
      const { password, ...rest } = request.body;

      if ((await findUserByUsername(rest.username)) !== null) {
        return reply.code(409).send({ message: "A user with this username already exists." });
      }

      if (rest.roleId != null && (await findRoleById(rest.roleId)) === null) {
        return reply.code(404).send({ message: "Role not found." });
      }

      const created = await insertUser({ ...rest, passwordHash: await hashPassword(password) });

      return reply.code(201).send(present(created));
    },
  );

  typed.get(
    "/users/:id",
    {
      config: { auth: Permission.ACCESS_READ },
      schema: {
        tags: ["users"],
        summary: "Cadastro e permissões efetivas",
        params: userIdParamsSchema,
        response: { 200: userSchema, 404: messageSchema },
      },
    },
    async (request, reply) => {
      const user = await findUserById(request.params.id);

      if (user === null) return reply.code(404).send({ message: "User not found." });

      return reply.send(present(user));
    },
  );

  typed.patch(
    "/users/:id",
    {
      config: { auth: Permission.ACCESS_UPDATE },
      schema: {
        tags: ["users"],
        summary: "Edita papel, permissões avulsas, nome e situação",
        params: userIdParamsSchema,
        body: updateUserBodySchema,
        response: { 200: userSchema, 404: messageSchema },
      },
    },
    async (request, reply) => {
      const user = await findUserById(request.params.id);

      if (user === null) return reply.code(404).send({ message: "User not found." });

      if (request.body.roleId != null && (await findRoleById(request.body.roleId)) === null) {
        return reply.code(404).send({ message: "Role not found." });
      }

      const updated = await updateUser(request.params.id, request.body);

      // Deactivating has to cut the access that is already in someone's hands, not only the next
      // login. Without this, a refresh token keeps the account alive for its full lifetime.
      if (request.body.isActive === false) await revokeAllRefreshTokens(user.id);

      return reply.send(present(updated));
    },
  );
}
```

Registre o módulo em `src/routes.ts`, depois de `rolesRoutes`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:integration`
Expected: PASS. Atualize o snapshot de rotas com `npm run test:integration -- -u` depois de conferir as linhas novas.

- [ ] **Step 7: Commit**

```bash
npm run typecheck && npx prettier --check .
git add src tests
git commit -m "feat(users): administer accounts, roles and individual permissions"
```

### Task 15: Troca de senha

Dois casos, dois módulos. A troca da própria senha é do "eu autenticado" e mora em
`/v1/sessions/me/password`, dentro de `auth`. O reset feito por administrador é operação de cadastro
e mora em `/v1/users/:id/password`, dentro de `users`.

**Files:**

- Modify: `src/modules/auth/auth.schemas.ts`
- Modify: `src/modules/auth/auth.routes.ts`
- Modify: `src/modules/users/users.schemas.ts`
- Modify: `src/modules/users/users.routes.ts`
- Test: `tests/modules/auth/auth.me-password.integration.test.ts`
- Test: `tests/modules/users/users.password.integration.test.ts`

**Interfaces:**

- Consumes: `hashPassword`, `verifyPassword` (Task 5), `updatePasswordHash` (Task 14), `revokeAllRefreshTokens` (Task 9), `authenticateAs` (Task 13).
- Produces: `PATCH /v1/sessions/me/password` e `PATCH /v1/users/:id/password`.

- [ ] **Step 1: Write the failing tests**

Crie `tests/modules/auth/auth.me-password.integration.test.ts`:

```ts
import { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyPassword } from "../../../src/modules/auth/auth.password.js";
import { authenticateAs, startTestApp } from "../../support/app.js";
import { resetDatabase, testPrisma } from "../../support/database.js";

const CURRENT = "correct horse battery";
const NEXT = "an-even-better-password";

let app: FastifyInstance;

// A fresh application per case, not per file: the login rate limiter keeps its counters in the
// instance, and authenticateAs signs in with the same username in every case.
beforeEach(async () => {
  app = await startTestApp();
});

afterEach(async () => {
  await app.close();
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("PATCH /v1/sessions/me/password", () => {
  it("replaces the password and ends every session, including the one that asked", async () => {
    const { userId, headers } = await authenticateAs(app, []);

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/sessions/me/password",
      headers,
      payload: { currentPassword: CURRENT, newPassword: NEXT },
    });

    const stored = await testPrisma.user.findUnique({ where: { id: userId } });
    const survivors = await testPrisma.refreshToken.count({ where: { userId, revokedAt: null } });

    expect(response.statusCode).toBe(204);
    expect(await verifyPassword(NEXT, stored!.passwordHash)).toBe(true);
    expect(survivors).toBe(0);
  });

  it("answers 401 when the current password is wrong, and keeps the old one", async () => {
    const { userId, headers } = await authenticateAs(app, []);

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/sessions/me/password",
      headers,
      payload: { currentPassword: "not-my-password", newPassword: NEXT },
    });

    const stored = await testPrisma.user.findUnique({ where: { id: userId } });

    expect(response.statusCode).toBe(401);
    expect(await verifyPassword(CURRENT, stored!.passwordHash)).toBe(true);
  });

  it("answers 400 for a new password shorter than eight characters", async () => {
    const { headers } = await authenticateAs(app, []);

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/sessions/me/password",
      headers,
      payload: { currentPassword: CURRENT, newPassword: "short" },
    });

    expect(response.statusCode).toBe(400);
  });
});
```

Crie `tests/modules/users/users.password.integration.test.ts`:

```ts
import { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Permission } from "../../../src/generated/prisma/index.js";
import { verifyPassword } from "../../../src/modules/auth/auth.password.js";
import { authenticateAs, startTestApp } from "../../support/app.js";
import { resetDatabase, testPrisma } from "../../support/database.js";

const NEXT = "an-even-better-password";

let app: FastifyInstance;

// A fresh application per case, not per file: the login rate limiter keeps its counters in the
// instance, and authenticateAs signs in with the same username in every case.
beforeEach(async () => {
  app = await startTestApp();
});

afterEach(async () => {
  await app.close();
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("PATCH /v1/users/:id/password", () => {
  it("resets another person's password without asking for the old one", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_UPDATE], "admin");
    const target = await authenticateAs(app, [], "target");

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/users/${target.userId}/password`,
      headers,
      payload: { newPassword: NEXT },
    });

    const stored = await testPrisma.user.findUnique({ where: { id: target.userId } });

    expect(response.statusCode).toBe(204);
    expect(await verifyPassword(NEXT, stored!.passwordHash)).toBe(true);
    expect((await app.inject({ method: "GET", url: "/v1/sessions/me", headers: target.headers })).statusCode).toBe(200);
    expect(await testPrisma.refreshToken.count({ where: { userId: target.userId, revokedAt: null } })).toBe(0);
  });

  it("answers 403 without ACCESS_UPDATE", async () => {
    const { headers } = await authenticateAs(app, [Permission.ACCESS_READ], "admin");
    const target = await authenticateAs(app, [], "target");

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/users/${target.userId}/password`,
      headers,
      payload: { newPassword: NEXT },
    });

    expect(response.statusCode).toBe(403);
  });
});
```

O access token do alvo continua valendo por até quinze minutos depois do reset; o que a troca corta é o refresh, e é por isso que o teste checa a contagem de tokens vivos em vez de esperar 401 imediato.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:integration -- tests/modules/auth/auth.me-password.integration.test.ts tests/modules/users/users.password.integration.test.ts`
Expected: FAIL — as rotas respondem 404.

- [ ] **Step 3: Write the schemas**

Acrescente a `src/modules/auth/auth.schemas.ts`:

```ts
export const changeOwnPasswordBodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
```

Acrescente a `src/modules/users/users.schemas.ts`:

```ts
export const resetPasswordBodySchema = z.object({
  newPassword: z.string().min(8),
});
```

- [ ] **Step 4: Write the route for one's own password**

Acrescente em `src/modules/auth/auth.routes.ts`, dentro de `authRoutes`:

```ts
typed.patch(
  "/sessions/me/password",
  {
    config: { auth: AUTHENTICATED },
    schema: {
      tags: ["auth"],
      summary: "Troca a própria senha",
      body: changeOwnPasswordBodySchema,
      response: { 204: z.void(), 401: messageSchema },
    },
  },
  async (request, reply) => {
    const user = await findUserById(request.currentUser!.id);
    const matches = await verifyPassword(request.body.currentPassword, user!.passwordHash);

    if (!matches) return reply.code(401).send(INVALID_CREDENTIALS);

    await updatePasswordHash(user!.id, await hashPassword(request.body.newPassword));

    // Every session goes, this one included. A refresh token stolen before the change would
    // otherwise outlive it, and the change would have solved nothing.
    await revokeAllRefreshTokens(user!.id);

    return reply.code(204).send();
  },
);
```

Acrescente aos imports do arquivo: `hashPassword` e `verifyPassword` de `./auth.password.js`, `updatePasswordHash` e `revokeAllRefreshTokens` de `./auth.repository.js`, e `changeOwnPasswordBodySchema` de `./auth.schemas.js`. `findUserById`, `AUTHENTICATED`, `messageSchema` e `INVALID_CREDENTIALS` já estão no arquivo desde a Task 10.

- [ ] **Step 5: Write the route for the administrator's reset**

Acrescente em `src/modules/users/users.routes.ts`, dentro de `usersRoutes`:

```ts
typed.patch(
  "/users/:id/password",
  {
    config: { auth: Permission.ACCESS_UPDATE },
    schema: {
      tags: ["users"],
      summary: "Reseta a senha de outro usuário",
      params: userIdParamsSchema,
      body: resetPasswordBodySchema,
      response: { 204: z.void(), 404: messageSchema },
    },
  },
  async (request, reply) => {
    const user = await findUserById(request.params.id);

    if (user === null) return reply.code(404).send({ message: "User not found." });

    await updatePasswordHash(user.id, await hashPassword(request.body.newPassword));
    await revokeAllRefreshTokens(user.id);

    return reply.code(204).send();
  },
);
```

Acrescente aos imports do arquivo: `hashPassword` de `../auth/auth.password.js`, `updatePasswordHash` e `revokeAllRefreshTokens` de `../auth/auth.repository.js`, e `resetPasswordBodySchema` de `./users.schemas.js`. `findUserById` já vem de `../auth/auth.repository.js` desde a Task 14.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:integration`
Expected: PASS. Atualize o snapshot de rotas depois de conferir as duas linhas novas.

- [ ] **Step 7: Commit**

```bash
npm run typecheck && npx prettier --check .
git add src tests
git commit -m "feat(auth): change and reset passwords, ending the affected sessions"
```

### Task 16: Seed do usuário inicial

`OWNER_USERNAME` e `OWNER_PASSWORD` são lidas pelo seed, e **não** entram no schema Zod da aplicação: exigi-las no boot obrigaria a produção a carregar para sempre a credencial de bootstrap.

**Files:**

- Create: `prisma/seed.ts`
- Modify: `package.json` (script `db:seed`)
- Modify: `.example.env`
- Test: `tests/prisma/seed.integration.test.ts`

**Interfaces:**

- Consumes: `hashPassword` (Task 5), o enum `Permission` (Task 1).
- Produces: `seed(prisma: PrismaClient, input: { username: string; password: string }): Promise<void>`, exportada para o teste, e a execução por linha de comando.

- [ ] **Step 1: Write the failing test**

Crie `tests/prisma/seed.integration.test.ts`:

```ts
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Permission } from "../../src/generated/prisma/index.js";
import { verifyPassword } from "../../src/modules/auth/auth.password.js";
import { seed } from "../../prisma/seed.js";
import { resetDatabase, testPrisma } from "../support/database.js";

const INPUT = { username: "owner", password: "the-owner-password" };

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("seed", () => {
  it("creates the Owner role holding every permission", async () => {
    await seed(testPrisma, INPUT);

    const role = await testPrisma.role.findUnique({ where: { name: "Owner" } });

    expect(role?.permissions.sort()).toEqual(Object.values(Permission).sort());
  });

  it("creates the first user with that role and the given password", async () => {
    await seed(testPrisma, INPUT);

    const user = await testPrisma.user.findUnique({ where: { username: "owner" }, include: { role: true } });

    expect(user?.role?.name).toBe("Owner");
    expect(await verifyPassword(INPUT.password, user!.passwordHash)).toBe(true);
  });

  it("does not duplicate anything when it runs twice", async () => {
    await seed(testPrisma, INPUT);
    await seed(testPrisma, INPUT);

    expect(await testPrisma.role.count()).toBe(1);
    expect(await testPrisma.user.count()).toBe(1);
  });

  it("does not overwrite a password that was already changed", async () => {
    await seed(testPrisma, INPUT);
    await testPrisma.user.update({ where: { username: "owner" }, data: { passwordHash: "already-changed" } });

    await seed(testPrisma, INPUT);

    const user = await testPrisma.user.findUnique({ where: { username: "owner" } });

    expect(user?.passwordHash).toBe("already-changed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- tests/prisma/seed.integration.test.ts`
Expected: FAIL — `Cannot find module '../../prisma/seed.js'`.

- [ ] **Step 3: Write the seed**

Crie `prisma/seed.ts`:

```ts
import { Permission, PrismaClient } from "../src/generated/prisma/index.js";
import { hashPassword } from "../src/modules/auth/auth.password.js";

const OWNER_ROLE = "Owner";

// Idempotent on purpose: running it again on a live database must not resurrect the bootstrap
// password of an account whose owner has already changed it.
export async function seed(prisma: PrismaClient, input: { username: string; password: string }): Promise<void> {
  const permissions = Object.values(Permission);

  const role = await prisma.role.upsert({
    where: { name: OWNER_ROLE },
    update: { permissions },
    create: { name: OWNER_ROLE, permissions },
  });

  const existing = await prisma.user.findUnique({ where: { username: input.username } });

  if (existing !== null) return;

  await prisma.user.create({
    data: {
      name: "Owner",
      username: input.username,
      passwordHash: await hashPassword(input.password),
      roleId: role.id,
    },
  });
}

// Runs only when the file is executed directly, so importing it from a test does not touch the
// developer's own database.
if (process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js")) {
  const username = process.env.OWNER_USERNAME;
  const password = process.env.OWNER_PASSWORD;

  if (username === undefined || password === undefined) {
    throw new Error("OWNER_USERNAME and OWNER_PASSWORD are required to seed the first user. See .example.env.");
  }

  const prisma = new PrismaClient();

  await seed(prisma, { username, password });
  await prisma.$disconnect();

  console.log(`Seeded the ${OWNER_ROLE} role and the user "${username}".`);
}
```

Em `package.json`, acrescente:

```json
"db:seed": "tsx prisma/seed.ts"
```

Em `tsconfig.check.json`, acrescente `"prisma/**/*"` ao `include` — sem isso o `npm run typecheck` não enxerga o seed nem o teste que o importa.

Em `.example.env`, acrescente:

```
OWNER_USERNAME=owner
OWNER_PASSWORD=change-me-on-the-first-login
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:integration`
Expected: PASS, quatro casos neste arquivo.

- [ ] **Step 5: Run the seed against the development database and log in**

```bash
npm run db:seed
npm run dev
```

Em outro terminal:

```bash
curl -s -X POST http://localhost:3333/v1/sessions/signin -H 'Content-Type: application/json' \
  -d '{"username":"owner","password":"change-me-on-the-first-login"}'
```

Expected: um JSON com `accessToken` e `refreshToken`.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npx prettier --check .
git add prisma tests package.json .example.env
git commit -m "feat(db): seed the owner role and the first user"
```

- [ ] **Step 7: Open the Fase 2 pull request**

```bash
git push -u origin feat/access-administration
```

Corpo do PR:

```
## What changed
- roles module — create, list, edit and remove the named permission packages
- users module — create and edit accounts, roles and individual permissions
- effective permission in the user response — read a person's access without recomputing it
- deactivation ends live sessions — revoke every refresh token of a deactivated user
- password change and reset — two routes, both ending the affected user's sessions
- owner seed — bootstrap the first account from the environment, idempotently

## Dependencies
- none
```

---

## Fecho da issue #35

Antes de fechar, confira contra o spec:

- [ ] `npm test` e `npm run test:integration` passam, e a saída é colada no PR.
- [ ] `npm run typecheck` e `npx prettier --check .` passam.
- [ ] O snapshot de rotas lista as quinze rotas do spec, cada uma com o acesso que ele manda.
- [ ] Nenhuma resposta da API carrega `passwordHash` — `grep -r "passwordHash" src/modules/*/*.routes.ts` só encontra leitura, nunca envio.
- [ ] `.example.env` documenta todas as variáveis novas.
- [ ] O `.env` de cada ambiente ganhou `JWT_SECRET` com pelo menos 32 caracteres, gerado por `openssl rand -base64 48`.
