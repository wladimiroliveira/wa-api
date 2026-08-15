# Autenticação e Autorização por Permissões de Módulo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar a API atrás de autenticação por JWT e autorização por permissão de módulo, sem que nenhuma rota possa nascer aberta por esquecimento.

**Architecture:** Um hook `onRequest` global verifica o access token, carrega usuário/papel/exceções do banco a cada requisição e anexa a permissão efetiva (`(papel ∪ granted) − denied`) em `request.auth`. Cada rota declara sua exigência com `requirePermission(Permission.X)`, `requireAuth()` ou `config: { public: true }`; um hook `onRoute` recusa a inicialização se alguma rota não declarar nada. Sessão longa vive num refresh token opaco guardado hasheado no banco, com rotação e detecção de reuso.

**Tech Stack:** TypeScript (ESM, `nodenext`), Fastify 5, `@fastify/jwt`, `@fastify/rate-limit`, `fastify-type-provider-zod` + Zod 4, Prisma 6 + PostgreSQL, `node:crypto` (`scrypt`, `sha256`), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-15-autenticacao-autorizacao-design.md` (issue #12)

## Global Constraints

- **Fonte única da permissão:** só `effectivePermissions()` calcula permissão efetiva. Nenhuma rota, serviço ou repositório refaz essa conta.
- **Default-deny:** rota sem `requireAuth()`, sem `requirePermission()` e sem `config: { public: true }` derruba a inicialização do servidor. Isso é comportamento desejado e tem teste.
- **Permissão lida do banco a cada requisição.** O token carrega apenas `sub`. Nunca embutir permissão no JWT.
- **Segredo nunca no repositório:** `JWT_SECRET` e `CORS_ORIGINS` vêm do ambiente e a inicialização falha se faltarem. O arquivo `.env` é editado pelo usuário, não pelo agente.
- **Senha e refresh token nunca em claro no banco:** senha com `scrypt`, refresh token com `sha256` do valor opaco.
- **Idioma:** identificadores, arquivos e testes em inglês; mensagens de negócio e texto ao usuário em português.
- **ESM:** imports relativos terminam em `.js`.
- **Decimais:** nada neste plano mexe em `Prisma.Decimal`; o domínio fica intacto.
- **TDD:** teste vermelho antes da implementação, com a saída colada. Commits em Conventional Commits, uma linha.
- **Base:** Postgres via `docker compose up -d --wait`. Cada PR sai de uma branch nova a partir de `main`.
- **Permissões (13):** `SUPPLIES_READ`, `SUPPLIES_WRITE`, `RECIPES_READ`, `RECIPES_WRITE`, `PRICING_READ`, `STOCK_READ`, `STOCK_WRITE`, `PRODUCTION_READ`, `PRODUCTION_WRITE`, `WASTE_READ`, `WASTE_WRITE`, `USERS_READ`, `USERS_WRITE`.

---

# PR 1 — Fundação

Branch: `feat/auth-foundation`. Nenhuma rota muda de comportamento; tudo aqui é
schema e função pura. A API continua aberta ao fim deste PR — é o preço de
fatiar, e o PR 2 fecha.

### Task 1: Schema — usuários, papéis, permissões e refresh tokens

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_auth_and_permissions/migration.sql` (gerado)
- Test: `tests/modules/auth/auth.schema.test.ts`

**Interfaces:**

- Produces (client gerado em `src/generated/prisma`): enum `Permission`; models `Role`, `User`, `RefreshToken`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/modules/auth/auth.schema.test.ts`:

```ts
import { afterAll, describe, expect, test } from "vitest";
import prisma from "../../../src/lib/prisma.js";
import { Permission } from "../../../src/generated/prisma/index.js";

describe("auth schema", () => {
  const createdRoleIds: string[] = [];
  const createdUserIds: string[] = [];

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
    await prisma.$disconnect();
  });

  test("o enum Permission tem as 13 permissões de módulo", () => {
    expect(Object.values(Permission).sort()).toEqual(
      [
        "PRICING_READ",
        "PRODUCTION_READ",
        "PRODUCTION_WRITE",
        "RECIPES_READ",
        "RECIPES_WRITE",
        "STOCK_READ",
        "STOCK_WRITE",
        "SUPPLIES_READ",
        "SUPPLIES_WRITE",
        "USERS_READ",
        "USERS_WRITE",
        "WASTE_READ",
        "WASTE_WRITE",
      ].sort(),
    );
  });

  test("papel guarda uma lista de permissões e usuário herda dele", async () => {
    const role = await prisma.role.create({
      data: { name: `Stock Keeper ${Date.now()}`, permissions: [Permission.STOCK_READ, Permission.STOCK_WRITE] },
    });
    createdRoleIds.push(role.id);

    const user = await prisma.user.create({
      data: {
        name: "Keeper",
        email: `keeper-${Date.now()}@example.test`,
        passwordHash: "scrypt:deadbeef:deadbeef",
        roleId: role.id,
        grantedPermissions: [Permission.PRICING_READ],
        deniedPermissions: [Permission.STOCK_WRITE],
      },
      include: { role: true },
    });
    createdUserIds.push(user.id);

    expect(user.role?.permissions).toEqual([Permission.STOCK_READ, Permission.STOCK_WRITE]);
    expect(user.grantedPermissions).toEqual([Permission.PRICING_READ]);
    expect(user.deniedPermissions).toEqual([Permission.STOCK_WRITE]);
    expect(user.isActive).toBe(true);
  });

  test("apagar o usuário leva junto os refresh tokens dele", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Ephemeral",
        email: `ephemeral-${Date.now()}@example.test`,
        passwordHash: "scrypt:deadbeef:deadbeef",
      },
    });

    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: `hash-${Date.now()}`, expiresAt: new Date(Date.now() + 60_000) },
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/modules/auth/auth.schema.test.ts`
Expected: FAIL — `Permission` não é exportado pelo client gerado.

- [ ] **Step 3: Editar `prisma/schema.prisma`**

Acrescentar ao fim do arquivo:

```prisma
enum Permission {
  SUPPLIES_READ
  SUPPLIES_WRITE
  RECIPES_READ
  RECIPES_WRITE
  PRICING_READ
  STOCK_READ
  STOCK_WRITE
  PRODUCTION_READ
  PRODUCTION_WRITE
  WASTE_READ
  WASTE_WRITE
  USERS_READ
  USERS_WRITE
}

model Role {
  id          String       @id @default(uuid())
  name        String       @unique
  permissions Permission[]
  users       User[]
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
}

model User {
  id                 String         @id @default(uuid())
  name               String
  email              String         @unique
  passwordHash       String
  roleId             String?
  role               Role?          @relation(fields: [roleId], references: [id], onDelete: SetNull)
  grantedPermissions Permission[]
  deniedPermissions  Permission[]
  isActive           Boolean        @default(true)
  refreshTokens      RefreshToken[]
  createdAt          DateTime       @default(now())
  updatedAt          DateTime       @updatedAt
}

model RefreshToken {
  id           String    @id @default(uuid())
  userId       String
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash    String    @unique
  expiresAt    DateTime
  revokedAt    DateTime?
  replacedById String?
  createdAt    DateTime  @default(now())
}
```

- [ ] **Step 4: Gerar a migração e o client**

Run: `docker compose up -d --wait && npx prisma migrate dev --name add_auth_and_permissions`
Expected: migração criada em `prisma/migrations/` e client regenerado em `src/generated/prisma`.

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/modules/auth/auth.schema.test.ts`
Expected: PASS, 3 testes.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/modules/auth/auth.schema.test.ts
git commit -m "feat(auth): add users, roles, permissions and refresh tokens to the schema"
```

---

### Task 2: Permissão efetiva

**Files:**

- Create: `src/modules/auth/auth.permissions.ts`
- Test: `tests/modules/auth/auth.permissions.test.ts`

**Interfaces:**

- Consumes: enum `Permission` da Task 1.
- Produces: `type PermissionSources = { rolePermissions: Permission[]; grantedPermissions: Permission[]; deniedPermissions: Permission[] }` e `effectivePermissions(sources: PermissionSources): Set<Permission>`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/modules/auth/auth.permissions.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { effectivePermissions } from "../../../src/modules/auth/auth.permissions.js";
import { Permission } from "../../../src/generated/prisma/index.js";

const empty = { rolePermissions: [], grantedPermissions: [], deniedPermissions: [] };

describe("effectivePermissions", () => {
  test("herda as permissões do papel", () => {
    const result = effectivePermissions({ ...empty, rolePermissions: [Permission.STOCK_READ] });

    expect([...result]).toEqual([Permission.STOCK_READ]);
  });

  test("soma as exceções concedidas ao usuário", () => {
    const result = effectivePermissions({
      ...empty,
      rolePermissions: [Permission.STOCK_READ],
      grantedPermissions: [Permission.PRICING_READ],
    });

    expect([...result].sort()).toEqual([Permission.PRICING_READ, Permission.STOCK_READ].sort());
  });

  test("subtrai as exceções negadas ao usuário", () => {
    const result = effectivePermissions({
      ...empty,
      rolePermissions: [Permission.STOCK_READ, Permission.STOCK_WRITE],
      deniedPermissions: [Permission.STOCK_WRITE],
    });

    expect([...result]).toEqual([Permission.STOCK_READ]);
  });

  test("negação ganha da concessão explícita", () => {
    const result = effectivePermissions({
      ...empty,
      grantedPermissions: [Permission.USERS_WRITE],
      deniedPermissions: [Permission.USERS_WRITE],
    });

    expect(result.has(Permission.USERS_WRITE)).toBe(false);
  });

  test("usuário sem papel fica só com o que foi concedido", () => {
    const result = effectivePermissions({ ...empty, grantedPermissions: [Permission.WASTE_READ] });

    expect([...result]).toEqual([Permission.WASTE_READ]);
  });

  test("usuário sem papel e sem exceção não tem permissão nenhuma", () => {
    expect(effectivePermissions(empty).size).toBe(0);
  });

  test("permissão repetida entre papel e concessão aparece uma vez só", () => {
    const result = effectivePermissions({
      ...empty,
      rolePermissions: [Permission.RECIPES_READ],
      grantedPermissions: [Permission.RECIPES_READ],
    });

    expect(result.size).toBe(1);
  });

  test("negar uma permissão que ninguém tem não quebra nada", () => {
    const result = effectivePermissions({
      ...empty,
      rolePermissions: [Permission.RECIPES_READ],
      deniedPermissions: [Permission.USERS_WRITE],
    });

    expect([...result]).toEqual([Permission.RECIPES_READ]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/modules/auth/auth.permissions.test.ts`
Expected: FAIL — módulo `auth.permissions.js` não encontrado.

- [ ] **Step 3: Implementar**

Criar `src/modules/auth/auth.permissions.ts`:

```ts
import type { Permission } from "../../generated/prisma/index.js";

export type PermissionSources = {
  rolePermissions: Permission[];
  grantedPermissions: Permission[];
  deniedPermissions: Permission[];
};

/**
 * efetiva = (papel ∪ concedidas) − negadas. Negação sempre ganha.
 * Única fonte da permissão efetiva no projeto.
 */
export function effectivePermissions(sources: PermissionSources): Set<Permission> {
  const effective = new Set<Permission>([...sources.rolePermissions, ...sources.grantedPermissions]);

  for (const denied of sources.deniedPermissions) effective.delete(denied);

  return effective;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/modules/auth/auth.permissions.test.ts`
Expected: PASS, 8 testes.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth/auth.permissions.ts tests/modules/auth/auth.permissions.test.ts
git commit -m "feat(auth): compute effective permissions from role and user exceptions"
```

---

### Task 3: Hash e verificação de senha

**Files:**

- Create: `src/modules/auth/auth.password.ts`
- Test: `tests/modules/auth/auth.password.test.ts`

**Interfaces:**

- Produces: `hashPassword(password: string): Promise<string>` e `verifyPassword(password: string, stored: string): Promise<boolean>`. Formato guardado: `scrypt:<salt hex>:<derivado hex>`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/modules/auth/auth.password.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { hashPassword, verifyPassword } from "../../../src/modules/auth/auth.password.js";

describe("password hashing", () => {
  test("o hash não contém a senha em claro", async () => {
    const hash = await hashPassword("senha-secreta");

    expect(hash).not.toContain("senha-secreta");
    expect(hash.startsWith("scrypt:")).toBe(true);
  });

  test("a mesma senha gera hashes diferentes por causa do salt", async () => {
    expect(await hashPassword("senha-secreta")).not.toBe(await hashPassword("senha-secreta"));
  });

  test("verifica a senha correta", async () => {
    const hash = await hashPassword("senha-secreta");

    expect(await verifyPassword("senha-secreta", hash)).toBe(true);
  });

  test("recusa a senha errada", async () => {
    const hash = await hashPassword("senha-secreta");

    expect(await verifyPassword("senha-errada", hash)).toBe(false);
  });

  test("recusa hash malformado sem estourar", async () => {
    expect(await verifyPassword("senha-secreta", "")).toBe(false);
    expect(await verifyPassword("senha-secreta", "senha-secreta")).toBe(false);
    expect(await verifyPassword("senha-secreta", "bcrypt:aa:bb")).toBe(false);
    expect(await verifyPassword("senha-secreta", "scrypt:aa")).toBe(false);
    expect(await verifyPassword("senha-secreta", "scrypt:aa:bb")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/modules/auth/auth.password.test.ts`
Expected: FAIL — módulo `auth.password.js` não encontrado.

- [ ] **Step 3: Implementar**

Criar `src/modules/auth/auth.password.ts`:

```ts
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const ALGORITHM = "scrypt";
const SALT_LENGTH = 16;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password, salt, KEY_LENGTH);

  return `${ALGORITHM}:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltHex, expectedHex] = stored.split(":");
  if (algorithm !== ALGORITHM || !saltHex || !expectedHex) return false;

  const expected = Buffer.from(expectedHex, "hex");
  if (expected.length !== KEY_LENGTH) return false;

  const derived = await scryptAsync(password, Buffer.from(saltHex, "hex"), KEY_LENGTH);

  return timingSafeEqual(expected, derived);
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/modules/auth/auth.password.test.ts`
Expected: PASS, 5 testes.

- [ ] **Step 5: Portão do PR 1**

Run: `npx tsc --noEmit && npx prettier --check . && npm test`
Expected: tudo verde. Colar a saída.

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth/auth.password.ts tests/modules/auth/auth.password.test.ts
git commit -m "feat(auth): hash and verify passwords with scrypt"
```

**PR 1 — corpo:**

```
## What changed
- Permission enum, Role, User and RefreshToken models — data model for module-level access control
- effectivePermissions() — single source for (role ∪ granted) − denied, denial always wins
- scrypt password hashing and verification — no plaintext password in the database

## Dependencies
- none
```

---

# PR 2 — Sessões e aplicação das regras

Branch: `feat/auth-enforcement`, a partir de `main` já com o PR 1 mesclado. É o
PR que fecha a API. Ao fim dele toda rota de domínio exige token e permissão.

### Task 4: Configuração de ambiente

**Files:**

- Create: `src/modules/auth/auth.config.ts`
- Create: `tests/setup-env.ts`
- Modify: `vitest.config.ts`
- Modify: `.example.env`
- Modify: `.github/workflows/ci.yml`
- Test: `tests/modules/auth/auth.config.test.ts`

**Interfaces:**

- Produces: `type AuthConfig = { jwtSecret: string; accessTokenTtl: string; refreshTokenTtlDays: number; corsOrigins: string[]; loginRateLimitMax: number }` e `loadAuthConfig(env?: NodeJS.ProcessEnv): AuthConfig`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/modules/auth/auth.config.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { loadAuthConfig } from "../../../src/modules/auth/auth.config.js";

const validEnv = {
  JWT_SECRET: "a".repeat(32),
  CORS_ORIGINS: "http://localhost:5173",
};

describe("loadAuthConfig", () => {
  test("aplica os padrões de vida útil dos tokens e do limite de login", () => {
    const config = loadAuthConfig(validEnv);

    expect(config.accessTokenTtl).toBe("15m");
    expect(config.refreshTokenTtlDays).toBe(30);
    expect(config.loginRateLimitMax).toBe(5);
  });

  test("quebra a lista de origens do CORS por vírgula, ignorando espaços", () => {
    const config = loadAuthConfig({ ...validEnv, CORS_ORIGINS: "http://a.test , http://b.test" });

    expect(config.corsOrigins).toEqual(["http://a.test", "http://b.test"]);
  });

  test("recusa segredo curto demais", () => {
    expect(() => loadAuthConfig({ ...validEnv, JWT_SECRET: "curto" })).toThrow(/JWT_SECRET/);
  });

  test("recusa ausência de JWT_SECRET", () => {
    expect(() => loadAuthConfig({ CORS_ORIGINS: "http://a.test" })).toThrow(/JWT_SECRET/);
  });

  test("recusa ausência de CORS_ORIGINS", () => {
    expect(() => loadAuthConfig({ JWT_SECRET: "a".repeat(32) })).toThrow(/CORS_ORIGINS/);
  });

  test("aceita sobrescrita da vida útil e do limite de login", () => {
    const config = loadAuthConfig({
      ...validEnv,
      ACCESS_TOKEN_TTL: "5m",
      REFRESH_TOKEN_TTL_DAYS: "7",
      LOGIN_RATE_LIMIT_MAX: "1000",
    });

    expect(config.accessTokenTtl).toBe("5m");
    expect(config.refreshTokenTtlDays).toBe(7);
    expect(config.loginRateLimitMax).toBe(1000);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/modules/auth/auth.config.test.ts`
Expected: FAIL — módulo `auth.config.js` não encontrado.

- [ ] **Step 3: Implementar**

Criar `src/modules/auth/auth.config.ts`:

```ts
import { z } from "zod";

const authEnvSchema = z.object({
  JWT_SECRET: z.string().min(32, "JWT_SECRET precisa de ao menos 32 caracteres"),
  CORS_ORIGINS: z.string().min(1, "CORS_ORIGINS precisa listar ao menos uma origem"),
  ACCESS_TOKEN_TTL: z.string().min(1).default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
});

export type AuthConfig = {
  jwtSecret: string;
  accessTokenTtl: string;
  refreshTokenTtlDays: number;
  corsOrigins: string[];
  loginRateLimitMax: number;
};

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const parsed = authEnvSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Configuração de autenticação inválida — ${details}`);
  }

  return {
    jwtSecret: parsed.data.JWT_SECRET,
    accessTokenTtl: parsed.data.ACCESS_TOKEN_TTL,
    refreshTokenTtlDays: parsed.data.REFRESH_TOKEN_TTL_DAYS,
    loginRateLimitMax: parsed.data.LOGIN_RATE_LIMIT_MAX,
    corsOrigins: parsed.data.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}
```

- [ ] **Step 4: Dar ambiente aos testes**

Criar `tests/setup-env.ts`:

```ts
process.env.JWT_SECRET ??= "test-secret-with-at-least-32-characters";
process.env.CORS_ORIGINS ??= "http://localhost:5173";
// Alto por padrão: os testes de integração fazem muitos logins do mesmo
// endereço. O teste do limite baixa este valor antes de construir o app.
process.env.LOGIN_RATE_LIMIT_MAX ??= "1000";
```

Modificar `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup-env.ts"],
  },
});
```

- [ ] **Step 5: Documentar as variáveis**

Acrescentar a `.example.env`:

```
JWT_SECRET="troque-por-um-segredo-de-32-caracteres-ou-mais"
CORS_ORIGINS="http://localhost:5173"
ACCESS_TOKEN_TTL="15m"
REFRESH_TOKEN_TTL_DAYS=30
LOGIN_RATE_LIMIT_MAX=5
```

Em `.github/workflows/ci.yml`, acrescentar ao bloco `env:` do topo do arquivo,
logo abaixo de `DATABASE_URL`:

```yaml
JWT_SECRET: ci-secret-with-at-least-32-characters
CORS_ORIGINS: http://localhost:5173
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/modules/auth/auth.config.test.ts`
Expected: PASS, 6 testes.

- [ ] **Step 7: Commit**

```bash
git add src/modules/auth/auth.config.ts tests/setup-env.ts tests/modules/auth/auth.config.test.ts vitest.config.ts .example.env .github/workflows/ci.yml
git commit -m "feat(auth): read and validate auth settings from the environment"
```

> **Passo manual do usuário:** o agente não edita `.env`. Antes de rodar
> `npm run dev`, acrescente ao seu `.env` local as mesmas quatro variáveis
> listadas em `.example.env`.

---

### Task 5: Tokens opacos, repositório e serviço de sessão

**Files:**

- Create: `src/modules/auth/auth.tokens.ts`
- Create: `src/modules/auth/auth.repository.ts`
- Create: `src/modules/auth/auth.service.ts`
- Test: `tests/modules/auth/auth.tokens.test.ts`
- Test: `tests/modules/auth/auth.service.test.ts`

**Interfaces:**

- Consumes: `hashPassword`/`verifyPassword` (Task 3), `loadAuthConfig` (Task 4).
- Produces:
  - `generateRefreshToken(): string`, `hashRefreshToken(token: string): string`
  - `findUserForAuthentication(email: string)`, `findActiveUserWithRole(id: string)` no repositório
  - `authenticate(email: string, password: string): Promise<{ id: string }>`
  - `issueRefreshToken(userId: string): Promise<string>`
  - `rotateRefreshToken(token: string): Promise<{ userId: string; refreshToken: string }>`
  - `revokeRefreshToken(token: string, userId: string): Promise<void>`
  - `class InvalidCredentialsError`, `class InvalidRefreshTokenError`

- [ ] **Step 1: Escrever o teste dos tokens**

Criar `tests/modules/auth/auth.tokens.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { generateRefreshToken, hashRefreshToken } from "../../../src/modules/auth/auth.tokens.js";

describe("refresh tokens", () => {
  test("gera token opaco com entropia suficiente", () => {
    expect(generateRefreshToken().length).toBeGreaterThanOrEqual(43);
  });

  test("dois tokens gerados nunca são iguais", () => {
    expect(generateRefreshToken()).not.toBe(generateRefreshToken());
  });

  test("o hash é determinístico e não revela o token", () => {
    const token = generateRefreshToken();
    const hash = hashRefreshToken(token);

    expect(hash).toBe(hashRefreshToken(token));
    expect(hash).not.toBe(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/modules/auth/auth.tokens.test.ts`
Expected: FAIL — módulo `auth.tokens.js` não encontrado.

- [ ] **Step 3: Implementar os tokens**

Criar `src/modules/auth/auth.tokens.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

export function generateRefreshToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * O refresh token já é 32 bytes aleatórios: não há dicionário a atacar,
 * então sha256 basta. KDF lento fica só para senha escolhida por gente.
 */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/modules/auth/auth.tokens.test.ts`
Expected: PASS, 3 testes.

- [ ] **Step 5: Implementar o repositório**

Criar `src/modules/auth/auth.repository.ts`:

```ts
import prisma from "../../lib/prisma.js";

export function findUserForAuthentication(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

export function findActiveUserWithRole(id: string) {
  return prisma.user.findFirst({ where: { id, isActive: true }, include: { role: true } });
}

export function findRefreshToken(tokenHash: string) {
  return prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
}

export function createRefreshToken(userId: string, tokenHash: string, expiresAt: Date) {
  return prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
}

export function replaceRefreshToken(currentId: string, userId: string, tokenHash: string, expiresAt: Date) {
  return prisma.$transaction(async (tx) => {
    const next = await tx.refreshToken.create({ data: { userId, tokenHash, expiresAt } });

    await tx.refreshToken.update({
      where: { id: currentId },
      data: { revokedAt: new Date(), replacedById: next.id },
    });

    return next;
  });
}

export function revokeRefreshTokenByHash(tokenHash: string, userId: string) {
  return prisma.refreshToken.updateMany({
    where: { tokenHash, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function revokeAllRefreshTokens(userId: string) {
  return prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
```

- [ ] **Step 6: Escrever o teste do serviço**

Criar `tests/modules/auth/auth.service.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import prisma from "../../../src/lib/prisma.js";
import { hashPassword } from "../../../src/modules/auth/auth.password.js";
import { hashRefreshToken } from "../../../src/modules/auth/auth.tokens.js";
import {
  authenticate,
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
} from "../../../src/modules/auth/auth.service.js";

const PASSWORD = "senha-de-teste";

describe("auth service (integração)", () => {
  const createdUserIds: string[] = [];

  async function createUser(overrides: { isActive?: boolean } = {}) {
    const user = await prisma.user.create({
      data: {
        name: "Service User",
        email: `service-${crypto.randomUUID()}@example.test`,
        passwordHash: await hashPassword(PASSWORD),
        isActive: overrides.isActive ?? true,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  test("autentica com a senha correta", async () => {
    const user = await createUser();

    expect((await authenticate(user.email, PASSWORD)).id).toBe(user.id);
  });

  test("recusa senha errada", async () => {
    const user = await createUser();

    await expect(authenticate(user.email, "errada")).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  test("recusa email inexistente", async () => {
    await expect(authenticate("ninguem@example.test", PASSWORD)).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  test("recusa usuário desativado", async () => {
    const user = await createUser({ isActive: false });

    await expect(authenticate(user.email, PASSWORD)).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  test("guarda apenas o hash do refresh token", async () => {
    const user = await createUser();
    const token = await issueRefreshToken(user.id);

    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(token) } });

    expect(stored).not.toBeNull();
    expect(await prisma.refreshToken.count({ where: { tokenHash: token } })).toBe(0);
  });

  test("rotaciona o token e marca o anterior como substituído", async () => {
    const user = await createUser();
    const first = await issueRefreshToken(user.id);

    const rotated = await rotateRefreshToken(first);

    expect(rotated.userId).toBe(user.id);
    expect(rotated.refreshToken).not.toBe(first);

    const previous = await prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(first) } });
    expect(previous?.revokedAt).not.toBeNull();
    expect(previous?.replacedById).not.toBeNull();
  });

  test("reuso de token já rotacionado derruba a sessão inteira", async () => {
    const user = await createUser();
    const first = await issueRefreshToken(user.id);
    const second = (await rotateRefreshToken(first)).refreshToken;

    await expect(rotateRefreshToken(first)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    await expect(rotateRefreshToken(second)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  test("recusa token expirado", async () => {
    const user = await createUser();
    const token = await issueRefreshToken(user.id);

    await prisma.refreshToken.update({
      where: { tokenHash: hashRefreshToken(token) },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    await expect(rotateRefreshToken(token)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  test("recusa token desconhecido", async () => {
    await expect(rotateRefreshToken("token-que-nunca-existiu")).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  test("logout revoga o token e ele não rotaciona mais", async () => {
    const user = await createUser();
    const token = await issueRefreshToken(user.id);

    await revokeRefreshToken(token, user.id);

    await expect(rotateRefreshToken(token)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  test("usuário desativado não consegue mais rotacionar", async () => {
    const user = await createUser();
    const token = await issueRefreshToken(user.id);

    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    await expect(rotateRefreshToken(token)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });
});
```

- [ ] **Step 7: Rodar e confirmar que falha**

Run: `npx vitest run tests/modules/auth/auth.service.test.ts`
Expected: FAIL — módulo `auth.service.js` não encontrado.

- [ ] **Step 8: Implementar o serviço**

Criar `src/modules/auth/auth.service.ts`:

```ts
import { loadAuthConfig } from "./auth.config.js";
import { hashPassword, verifyPassword } from "./auth.password.js";
import { generateRefreshToken, hashRefreshToken } from "./auth.tokens.js";
import * as repo from "./auth.repository.js";

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Email ou senha inválidos");
  }
}

export class InvalidRefreshTokenError extends Error {
  constructor() {
    super("Refresh token inválido ou expirado");
  }
}

/** Hash descartável: mantém o custo do login parecido quando o email não existe. */
const decoyHash = await hashPassword(generateRefreshToken());

export async function authenticate(email: string, password: string): Promise<{ id: string }> {
  const user = await repo.findUserForAuthentication(email);

  if (!user || !user.isActive) {
    await verifyPassword(password, decoyHash);
    throw new InvalidCredentialsError();
  }

  if (!(await verifyPassword(password, user.passwordHash))) throw new InvalidCredentialsError();

  return { id: user.id };
}

function expiryFromNow(): Date {
  const { refreshTokenTtlDays } = loadAuthConfig();
  return new Date(Date.now() + refreshTokenTtlDays * 24 * 60 * 60 * 1000);
}

export async function issueRefreshToken(userId: string): Promise<string> {
  const token = generateRefreshToken();
  await repo.createRefreshToken(userId, hashRefreshToken(token), expiryFromNow());

  return token;
}

export async function rotateRefreshToken(token: string): Promise<{ userId: string; refreshToken: string }> {
  const stored = await repo.findRefreshToken(hashRefreshToken(token));

  if (!stored) throw new InvalidRefreshTokenError();

  // Token já rotacionado ou revogado sendo reapresentado: trata como roubo.
  if (stored.revokedAt) {
    await repo.revokeAllRefreshTokens(stored.userId);
    throw new InvalidRefreshTokenError();
  }

  if (stored.expiresAt <= new Date() || !stored.user.isActive) throw new InvalidRefreshTokenError();

  const next = generateRefreshToken();
  await repo.replaceRefreshToken(stored.id, stored.userId, hashRefreshToken(next), expiryFromNow());

  return { userId: stored.userId, refreshToken: next };
}

export async function revokeRefreshToken(token: string, userId: string): Promise<void> {
  await repo.revokeRefreshTokenByHash(hashRefreshToken(token), userId);
}
```

- [ ] **Step 9: Rodar e confirmar que passa**

Run: `npx vitest run tests/modules/auth/auth.service.test.ts`
Expected: PASS, 11 testes.

- [ ] **Step 10: Commit**

```bash
git add src/modules/auth/auth.tokens.ts src/modules/auth/auth.repository.ts src/modules/auth/auth.service.ts tests/modules/auth/auth.tokens.test.ts tests/modules/auth/auth.service.test.ts
git commit -m "feat(auth): issue, rotate and revoke refresh tokens with reuse detection"
```

---

### Task 6: Rotas de sessão

**Files:**

- Create: `src/modules/auth/auth.schema.ts`
- Create: `src/modules/auth/auth.routes.ts`
- Modify: `src/routes.ts`
- Modify: `package.json`
- Test: coberto pela Task 7 (`tests/modules/auth/auth.routes.test.ts`), que só passa com o plugin no lugar

**Interfaces:**

- Consumes: serviço da Task 5, `requireAuth()` da Task 7.
- Produces: `POST /sessions`, `POST /sessions/refresh`, `DELETE /sessions`; o access token é assinado com `app.jwt.sign({ sub })`.

> Esta task e a Task 7 se fecham mutuamente: as rotas precisam do guarda e o
> plugin precisa de uma rota pública para provar que a exceção funciona.
> Implemente as duas e rode o teste da Task 7 ao final.

- [ ] **Step 1: Instalar o `@fastify/jwt`**

Run: `npm install @fastify/jwt@10.2.2`
Expected: entra em `dependencies` (não use `--save-dev`; `tests/package/runtime-dependencies.test.ts` reprova).

- [ ] **Step 2: Criar os schemas**

Criar `src/modules/auth/auth.schema.ts`:

```ts
import { z } from "zod";

export const createSessionSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshSessionSchema = z.object({
  refreshToken: z.string().min(1),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type RefreshSessionInput = z.infer<typeof refreshSessionSchema>;
```

- [ ] **Step 3: Criar as rotas**

Criar `src/modules/auth/auth.routes.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { createSessionSchema, refreshSessionSchema } from "./auth.schema.js";
import { loadAuthConfig } from "./auth.config.js";
import { requireAuth } from "./auth.guard.js";
import {
  authenticate,
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
} from "./auth.service.js";

export default async function authRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { accessTokenTtl } = loadAuthConfig();

  const signAccessToken = (userId: string) => app.jwt.sign({ sub: userId }, { expiresIn: accessTokenTtl });

  r.post(
    "/sessions",
    { config: { public: true }, schema: { body: createSessionSchema, security: [] } },
    async (req, reply) => {
      try {
        const user = await authenticate(req.body.email, req.body.password);

        return { accessToken: signAccessToken(user.id), refreshToken: await issueRefreshToken(user.id) };
      } catch (err) {
        if (err instanceof InvalidCredentialsError) return reply.status(401).send({ message: err.message });
        throw err;
      }
    },
  );

  r.post(
    "/sessions/refresh",
    { config: { public: true }, schema: { body: refreshSessionSchema, security: [] } },
    async (req, reply) => {
      try {
        const rotated = await rotateRefreshToken(req.body.refreshToken);

        return { accessToken: signAccessToken(rotated.userId), refreshToken: rotated.refreshToken };
      } catch (err) {
        if (err instanceof InvalidRefreshTokenError) return reply.status(401).send({ message: err.message });
        throw err;
      }
    },
  );

  r.delete("/sessions", { preHandler: requireAuth(), schema: { body: refreshSessionSchema } }, async (req, reply) => {
    await revokeRefreshToken(req.body.refreshToken, req.auth.user.id);

    return reply.status(204).send();
  });
}
```

- [ ] **Step 4: Registrar as rotas**

Em `src/routes.ts`, importar e registrar antes dos demais módulos:

```ts
import authRoutes from "./modules/auth/auth.routes.js";
```

```ts
await app.register(healthRoutes);
await app.register(authRoutes);
```

- [ ] **Step 5: Commit (junto com a Task 7)**

Não commite ainda; o código só compila com o plugin da Task 7.

---

### Task 7: Plugin default-deny, guardas e ligação no servidor

**Files:**

- Create: `src/modules/auth/auth.guard.ts`
- Create: `src/modules/auth/auth.plugin.ts`
- Modify: `src/modules/health/health.routes.ts`
- Modify: `src/server.ts`
- Test: `tests/modules/auth/auth.routes.test.ts`
- Test: `tests/modules/auth/auth.coverage.test.ts`

**Interfaces:**

- Consumes: `effectivePermissions` (Task 2), `loadAuthConfig` (Task 4), `findActiveUserWithRole` (Task 5).
- Produces:
  - `AUTH_GUARD` (symbol), `requireAuth(): AuthGuard`, `requirePermission(permission: Permission): AuthGuard`
  - `registerAuth(app: FastifyInstance): Promise<void>`
  - `request.auth: { user: { id: string; name: string; email: string }; permissions: Set<Permission> }`
  - `config: { public: true }` como declaração de rota pública

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/modules/auth/auth.routes.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import prisma from "../../../src/lib/prisma.js";
import { hashPassword } from "../../../src/modules/auth/auth.password.js";
import { Permission } from "../../../src/generated/prisma/index.js";

const PASSWORD = "senha-de-teste";

describe("session routes (integração)", () => {
  let app: FastifyInstance;
  const createdUserIds: string[] = [];
  let email: string;
  let userId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    email = `session-${crypto.randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        name: "Session User",
        email,
        passwordHash: await hashPassword(PASSWORD),
        grantedPermissions: [Permission.SUPPLIES_READ],
      },
    });
    userId = user.id;
    createdUserIds.push(user.id);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  });

  async function login() {
    return app.inject({ method: "POST", url: "/sessions", payload: { email, password: PASSWORD } });
  }

  test("login devolve access e refresh token", async () => {
    const res = await login();

    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toEqual(expect.any(String));
    expect(res.json().refreshToken).toEqual(expect.any(String));
  });

  test("login com senha errada → 401", async () => {
    const res = await app.inject({ method: "POST", url: "/sessions", payload: { email, password: "errada" } });

    expect(res.statusCode).toBe(401);
  });

  test("refresh rotaciona o par de tokens", async () => {
    const { refreshToken } = (await login()).json();

    const res = await app.inject({ method: "POST", url: "/sessions/refresh", payload: { refreshToken } });

    expect(res.statusCode).toBe(200);
    expect(res.json().refreshToken).not.toBe(refreshToken);
  });

  test("reusar refresh já rotacionado → 401", async () => {
    const { refreshToken } = (await login()).json();
    await app.inject({ method: "POST", url: "/sessions/refresh", payload: { refreshToken } });

    const res = await app.inject({ method: "POST", url: "/sessions/refresh", payload: { refreshToken } });

    expect(res.statusCode).toBe(401);
  });

  test("logout revoga o refresh token", async () => {
    const { accessToken, refreshToken } = (await login()).json();

    const logout = await app.inject({
      method: "DELETE",
      url: "/sessions",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { refreshToken },
    });
    expect(logout.statusCode).toBe(204);

    const reuse = await app.inject({ method: "POST", url: "/sessions/refresh", payload: { refreshToken } });
    expect(reuse.statusCode).toBe(401);
  });

  test("rota protegida sem token → 401", async () => {
    expect((await app.inject({ method: "GET", url: "/supplies" })).statusCode).toBe(401);
  });

  test("token malformado → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/supplies",
      headers: { authorization: "Bearer nao-e-um-jwt" },
    });

    expect(res.statusCode).toBe(401);
  });

  test("access token expirado → 401", async () => {
    const expired = app.jwt.sign({ sub: userId }, { expiresIn: "-1s" });

    const res = await app.inject({
      method: "GET",
      url: "/supplies",
      headers: { authorization: `Bearer ${expired}` },
    });

    expect(res.statusCode).toBe(401);
  });

  test("token válido sem a permissão exigida → 403", async () => {
    const { accessToken } = (await login()).json();

    const res = await app.inject({
      method: "POST",
      url: "/supplies",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: "Bloqueado", type: "INGREDIENT", purchaseUnit: "KG", purchaseQty: 1, purchasePrice: 1 },
    });

    expect(res.statusCode).toBe(403);
  });

  test("token válido com a permissão exigida passa", async () => {
    const { accessToken } = (await login()).json();

    const res = await app.inject({
      method: "GET",
      url: "/supplies",
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  test("desativar o usuário corta o acesso no request seguinte", async () => {
    const { accessToken } = (await login()).json();
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });

    const res = await app.inject({
      method: "GET",
      url: "/supplies",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(401);

    await prisma.user.update({ where: { id: userId }, data: { isActive: true } });
  });

  test("rotas públicas seguem abertas", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBeLessThan(500);
    expect((await app.inject({ method: "GET", url: "/docs" })).statusCode).toBeLessThan(400);
  });
});
```

Criar `tests/modules/auth/auth.coverage.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import fastify from "fastify";
import { registerAuth } from "../../../src/modules/auth/auth.plugin.js";
import { requirePermission } from "../../../src/modules/auth/auth.guard.js";
import { Permission } from "../../../src/generated/prisma/index.js";

describe("cobertura de autorização das rotas", () => {
  test("rota sem declaração de exigência derruba a inicialização", async () => {
    const app = fastify();
    await registerAuth(app);
    // Dentro de um plugin, como no app de verdade: o erro aparece no boot.
    app.register(async (instance) => {
      instance.get("/unguarded", async () => ({ ok: true }));
    });

    await expect(app.ready()).rejects.toThrow(/não declara/);
    await app.close();
  });

  test("rota com requirePermission inicia normalmente", async () => {
    const app = fastify();
    await registerAuth(app);
    app.register(async (instance) => {
      instance.get("/guarded", { preHandler: requirePermission(Permission.SUPPLIES_READ) }, async () => ({ ok: true }));
    });

    await expect(app.ready()).resolves.toBeTruthy();
    await app.close();
  });

  test("rota marcada como pública inicia normalmente", async () => {
    const app = fastify();
    await registerAuth(app);
    app.register(async (instance) => {
      instance.get("/open", { config: { public: true } }, async () => ({ ok: true }));
    });

    await expect(app.ready()).resolves.toBeTruthy();
    await app.close();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/modules/auth`
Expected: FAIL — módulos `auth.guard.js` e `auth.plugin.js` não encontrados.

- [ ] **Step 3: Implementar os guardas**

Criar `src/modules/auth/auth.guard.ts`:

```ts
import type { preHandlerAsyncHookHandler } from "fastify";
import type { Permission } from "../../generated/prisma/index.js";

export const AUTH_GUARD = Symbol.for("wa-api.auth-guard");

export type AuthGuard = preHandlerAsyncHookHandler & { [AUTH_GUARD]: Permission | null };

function markGuard(handler: preHandlerAsyncHookHandler, permission: Permission | null): AuthGuard {
  return Object.assign(handler, { [AUTH_GUARD]: permission });
}

/** Basta estar autenticado; nenhuma permissão de módulo é exigida. */
export function requireAuth(): AuthGuard {
  return markGuard(async () => {}, null);
}

export function requirePermission(permission: Permission): AuthGuard {
  return markGuard(async (request, reply) => {
    if (!request.auth.permissions.has(permission)) {
      return reply.status(403).send({ message: "Permissão insuficiente para esta operação" });
    }
  }, permission);
}

export function isAuthGuard(handler: unknown): boolean {
  return typeof handler === "function" && AUTH_GUARD in handler;
}
```

- [ ] **Step 4: Implementar o plugin**

Criar `src/modules/auth/auth.plugin.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { fastifyJwt } from "@fastify/jwt";
import type { Permission } from "../../generated/prisma/index.js";
import { loadAuthConfig } from "./auth.config.js";
import { effectivePermissions } from "./auth.permissions.js";
import { isAuthGuard } from "./auth.guard.js";
import { findActiveUserWithRole } from "./auth.repository.js";

export type AuthContext = {
  user: { id: string; name: string; email: string };
  permissions: Set<Permission>;
};

declare module "fastify" {
  interface FastifyContextConfig {
    public?: boolean;
  }

  interface FastifyRequest {
    auth: AuthContext;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

/**
 * Registra a autenticação na instância raiz. Precisa vir DEPOIS do swagger-ui
 * (para que /docs siga público) e ANTES das rotas da aplicação — hooks só valem
 * para rotas registradas depois deles.
 */
export async function registerAuth(app: FastifyInstance): Promise<void> {
  const { jwtSecret } = loadAuthConfig();

  await app.register(fastifyJwt, { secret: jwtSecret });

  app.decorateRequest("auth", null);

  // Default-deny na inicialização: rota que não declara nada não sobe.
  app.addHook("onRoute", (route) => {
    if (route.config?.public) return;

    const preHandlers = [route.preHandler ?? []].flat();
    if (preHandlers.some(isAuthGuard)) return;

    const method = [route.method].flat().join("/");
    throw new Error(
      `Rota ${method} ${route.url} não declara requireAuth(), requirePermission() nem config: { public: true }`,
    );
  });

  app.addHook("onRequest", async (request, reply) => {
    if (request.routeOptions.config?.public) return;

    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ message: "Autenticação necessária" });
    }

    const user = await findActiveUserWithRole(request.user.sub);
    if (!user) return reply.status(401).send({ message: "Autenticação necessária" });

    request.auth = {
      user: { id: user.id, name: user.name, email: user.email },
      permissions: effectivePermissions({
        rolePermissions: user.role?.permissions ?? [],
        grantedPermissions: user.grantedPermissions,
        deniedPermissions: user.deniedPermissions,
      }),
    };
  });
}
```

- [ ] **Step 5: Marcar `/health` como pública**

Em `src/modules/health/health.routes.ts`, trocar a assinatura da rota:

```ts
  r.get("/health", { config: { public: true }, schema: { security: [] } }, async (req, reply) => {
```

- [ ] **Step 6: Ligar no servidor**

Em `src/server.ts`, importar:

```ts
import { registerAuth } from "./modules/auth/auth.plugin.js";
```

No objeto `openapi`, exigir o bearer por padrão — acrescentar depois de `components`:

```ts
      security: [{ BearerAuth: [] }],
```

E, entre o registro do swagger-ui e o das rotas:

```ts
await app.register(fastifySwaggerUi, {
  routePrefix: "/docs",
});

// Depois do swagger-ui (para /docs seguir aberto) e antes das rotas.
await registerAuth(app);

app.setErrorHandler(errorHandler);
app.register(routes);
```

- [ ] **Step 7: Rodar os testes de auth**

Run: `npx vitest run tests/modules/auth`
Expected: `auth.coverage.test.ts` PASS. `auth.routes.test.ts` ainda FALHA nos
testes que batem em `/supplies` — a rota só ganha guarda na Task 8, então a
inicialização do app inteiro recusa. Isso é esperado; siga para a Task 8 e volte.

- [ ] **Step 8: Commit (depois da Task 8 verde)**

---

### Task 8: Exigência nas 20 rotas existentes e conserto dos testes

**Files:**

- Modify: `src/modules/supplies/supplies.routes.ts`
- Modify: `src/modules/recipes/recipes.routes.ts`
- Modify: `src/modules/pricing/pricing.routes.ts`
- Modify: `src/modules/stock/stock.routes.ts`
- Modify: `src/modules/waste/waste.routes.ts`
- Modify: `src/modules/production/production.routes.ts`
- Create: `tests/helpers/auth.ts`
- Modify: `tests/modules/supplies/supplies.routes.test.ts`
- Modify: `tests/modules/recipes/recipes.routes.test.ts`
- Modify: `tests/modules/pricing/pricing.routes.test.ts`
- Modify: `tests/modules/stock/stock.routes.test.ts`
- Modify: `tests/modules/waste/waste.routes.test.ts`
- Modify: `tests/modules/production/production.routes.test.ts`

**Interfaces:**

- Consumes: `requirePermission` (Task 7), `hashPassword` (Task 3).
- Produces: `createActor(app, permissions): Promise<TestActor>`, `deleteActor(userId): Promise<void>`, `ALL_PERMISSIONS`, com `TestActor = { userId: string; headers: { authorization: string } }`.

- [ ] **Step 1: Mapa completo rota → permissão**

| Arquivo                | Rota                               | Guarda                                           |
| ---------------------- | ---------------------------------- | ------------------------------------------------ |
| `supplies.routes.ts`   | `GET /supplies`                    | `requirePermission(Permission.SUPPLIES_READ)`    |
| `supplies.routes.ts`   | `POST /supplies`                   | `requirePermission(Permission.SUPPLIES_WRITE)`   |
| `supplies.routes.ts`   | `GET /supplies/:id`                | `requirePermission(Permission.SUPPLIES_READ)`    |
| `supplies.routes.ts`   | `PATCH /supplies/:id`              | `requirePermission(Permission.SUPPLIES_WRITE)`   |
| `supplies.routes.ts`   | `DELETE /supplies/:id`             | `requirePermission(Permission.SUPPLIES_WRITE)`   |
| `recipes.routes.ts`    | `GET /recipes`                     | `requirePermission(Permission.RECIPES_READ)`     |
| `recipes.routes.ts`    | `POST /recipes`                    | `requirePermission(Permission.RECIPES_WRITE)`    |
| `recipes.routes.ts`    | `GET /recipes/:id`                 | `requirePermission(Permission.RECIPES_READ)`     |
| `recipes.routes.ts`    | `PATCH /recipes/:id/margin`        | `requirePermission(Permission.RECIPES_WRITE)`    |
| `recipes.routes.ts`    | `PATCH /recipes/:id`               | `requirePermission(Permission.RECIPES_WRITE)`    |
| `recipes.routes.ts`    | `DELETE /recipes/:id`              | `requirePermission(Permission.RECIPES_WRITE)`    |
| `pricing.routes.ts`    | `GET /recipes/:id/pricing`         | `requirePermission(Permission.PRICING_READ)`     |
| `stock.routes.ts`      | `POST /supplies/:id/stock-entries` | `requirePermission(Permission.STOCK_WRITE)`      |
| `stock.routes.ts`      | `GET /supplies/:id/movements`      | `requirePermission(Permission.STOCK_READ)`       |
| `waste.routes.ts`      | `POST /supplies/:id/wastes`        | `requirePermission(Permission.WASTE_WRITE)`      |
| `waste.routes.ts`      | `GET /wastes`                      | `requirePermission(Permission.WASTE_READ)`       |
| `production.routes.ts` | `POST /productions`                | `requirePermission(Permission.PRODUCTION_WRITE)` |
| `production.routes.ts` | `GET /productions`                 | `requirePermission(Permission.PRODUCTION_READ)`  |
| `production.routes.ts` | `GET /productions/:id`             | `requirePermission(Permission.PRODUCTION_READ)`  |

`POST /productions` exige apenas `PRODUCTION_WRITE`, por decisão registrada na
spec: registrar produção pressupõe o consumo de insumo.

- [ ] **Step 2: Aplicar em cada arquivo de rota**

Em cada um dos seis arquivos, acrescentar os imports:

```ts
import { requirePermission } from "../auth/auth.guard.js";
import { Permission } from "../../generated/prisma/index.js";
```

E acrescentar `preHandler` a cada rota. Rota sem objeto de opções ganha um;
rota que já tem objeto ganha mais uma chave. Exemplo completo em
`src/modules/supplies/supplies.routes.ts`:

```ts
r.get("/supplies", { preHandler: requirePermission(Permission.SUPPLIES_READ) }, async () => repo.listSupplies());

r.post(
  "/supplies",
  { preHandler: requirePermission(Permission.SUPPLIES_WRITE), schema: { body: createSupplySchema } },
  async (req, reply) => {
    const supply = await repo.createSupply(req.body);
    return reply.status(201).send(supply);
  },
);

r.get(
  "/supplies/:id",
  { preHandler: requirePermission(Permission.SUPPLIES_READ), schema: { params: supplyIdParamSchema } },
  async (req, reply) => {
    const supply = await repo.getSupply(req.params.id);
    if (!supply) return reply.status(404).send({ message: "Insumo não encontrado" });
    return supply;
  },
);
```

Repetir para as demais 17 rotas conforme a tabela do Step 1.

- [ ] **Step 3: Criar o helper de teste**

Criar `tests/helpers/auth.ts`:

```ts
import type { FastifyInstance } from "fastify";
import prisma from "../../src/lib/prisma.js";
import { hashPassword } from "../../src/modules/auth/auth.password.js";
import { Permission } from "../../src/generated/prisma/index.js";

export type TestActor = { userId: string; headers: { authorization: string } };

export const ALL_PERMISSIONS = Object.values(Permission);

/** Cria um usuário com as permissões pedidas e devolve o cabeçalho pronto. */
export async function createActor(app: FastifyInstance, permissions: Permission[]): Promise<TestActor> {
  const user = await prisma.user.create({
    data: {
      name: "Test Actor",
      email: `actor-${crypto.randomUUID()}@example.test`,
      passwordHash: await hashPassword(`pwd-${crypto.randomUUID()}`),
      grantedPermissions: permissions,
    },
  });

  return { userId: user.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: user.id })}` } };
}

export async function deleteActor(userId: string): Promise<void> {
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
}
```

- [ ] **Step 4: Autenticar os seis arquivos de teste existentes**

Em cada um, importar o helper, criar o ator no `beforeAll` e removê-lo no
`afterAll`, e passar `headers: actor.headers` em **todo** `app.inject`. Exemplo
completo do antes e depois em `tests/modules/supplies/supplies.routes.test.ts`:

```ts
import { createActor, deleteActor, ALL_PERMISSIONS, type TestActor } from "../../helpers/auth.js";

let actor: TestActor;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  actor = await createActor(app, ALL_PERMISSIONS);
});

afterAll(async () => {
  await prisma.supply
    .deleteMany({ where: { id: { in: createdIds } } })
    .catch((e) => console.warn("cleanup supplies:", e));
  await deleteActor(actor.userId);
  await app.close();
});
```

Antes:

```ts
const res = await app.inject({ method: "GET", url: "/supplies" });
```

Depois:

```ts
const res = await app.inject({ method: "GET", url: "/supplies", headers: actor.headers });
```

Aplicar o mesmo padrão em `recipes`, `pricing`, `stock`, `waste` e `production`.
`tests/modules/health/health.routes.test.ts` e `tests/lib/prisma.smoke.test.ts`
não mudam — `/health` é pública.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS, incluindo `auth.routes.test.ts` da Task 7 e os seis arquivos
consertados. Colar a saída.

- [ ] **Step 6: Verificar tipos e formatação**

Run: `npx tsc --noEmit && npx prettier --write . && npx prettier --check .`
Expected: sem erro.

- [ ] **Step 7: Commit das Tasks 6, 7 e 8**

```bash
git add -A
git commit -m "feat(auth): require a token and a module permission on every domain route"
```

---

### Task 9: Limite de tentativas no login

**Files:**

- Modify: `src/modules/auth/auth.routes.ts`
- Modify: `package.json`
- Test: `tests/modules/auth/auth.rate-limit.test.ts`

**Interfaces:**

- Consumes: `loadAuthConfig().loginRateLimitMax` (Task 4).
- Produces: `POST /sessions` responde `429` após `LOGIN_RATE_LIMIT_MAX` tentativas (padrão 5) na mesma janela de 15 minutos, por endereço.

> O limite é configurável de propósito: `tests/setup-env.ts` o deixa alto para
> que os testes de integração possam fazer vários logins do mesmo endereço, e
> só este teste o baixa.

- [ ] **Step 1: Instalar o `@fastify/rate-limit`**

Run: `npm install @fastify/rate-limit@11.2.0`
Expected: entra em `dependencies`.

- [ ] **Step 2: Escrever o teste que falha**

Criar `tests/modules/auth/auth.rate-limit.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";

describe("limite de tentativas no login", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Precisa vir antes do buildApp: o limite é lido no registro das rotas.
    process.env.LOGIN_RATE_LIMIT_MAX = "5";
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env.LOGIN_RATE_LIMIT_MAX = "1000";
  });

  test("bloqueia com 429 depois de seis tentativas do mesmo IP", async () => {
    const attempt = () =>
      app.inject({
        method: "POST",
        url: "/sessions",
        remoteAddress: "203.0.113.7",
        payload: { email: "forca-bruta@example.test", password: "chute" },
      });

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await attempt()).statusCode);

    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });

  test("o refresh não é afetado pelo limite do login", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/sessions/refresh",
      remoteAddress: "203.0.113.7",
      payload: { refreshToken: "invalido" },
    });

    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npx vitest run tests/modules/auth/auth.rate-limit.test.ts`
Expected: FAIL — a sexta tentativa devolve `401`, não `429`.

- [ ] **Step 4: Implementar**

Em `src/modules/auth/auth.routes.ts`, importar e registrar o plugin dentro do
escopo das rotas de sessão, e aplicar o limite só no login:

```ts
import { fastifyRateLimit } from "@fastify/rate-limit";
```

Logo no começo de `authRoutes`, antes das rotas — `loginRateLimitMax` sai do
`loadAuthConfig()` que a função já chama:

```ts
const { accessTokenTtl, loginRateLimitMax } = loadAuthConfig();

await app.register(fastifyRateLimit, { global: false });
```

E na rota `POST /sessions`, acrescentar a chave `config`:

```ts
  r.post(
    "/sessions",
    {
      config: { public: true, rateLimit: { max: loginRateLimitMax, timeWindow: "15 minutes" } },
      schema: { body: createSessionSchema, security: [] },
    },
    async (req, reply) => {
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npx vitest run tests/modules/auth/auth.rate-limit.test.ts`
Expected: PASS, 2 testes.

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth/auth.routes.ts tests/modules/auth/auth.rate-limit.test.ts package.json package-lock.json
git commit -m "feat(auth): rate limit login attempts per address"
```

---

### Task 10: CORS por variável de ambiente

**Files:**

- Modify: `src/server.ts`
- Test: `tests/modules/auth/auth.cors.test.ts`

**Interfaces:**

- Consumes: `loadAuthConfig().corsOrigins` (Task 4).

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/modules/auth/auth.cors.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";

describe("CORS", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  test("libera a origem configurada", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "http://localhost:5173" },
    });

    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  test("não libera origem fora da lista", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "http://invasor.test" },
    });

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/modules/auth/auth.cors.test.ts`
Expected: FAIL — com `origin: ["*"]` a origem do invasor também é liberada.

- [ ] **Step 3: Implementar**

Em `src/server.ts`, importar `loadAuthConfig` e trocar o registro do CORS:

```ts
import { loadAuthConfig } from "./modules/auth/auth.config.js";
```

```ts
const { corsOrigins } = loadAuthConfig();

await app.register(fastifyCors, {
  origin: corsOrigins,
  methods: ["GET", "POST", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
});
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/modules/auth/auth.cors.test.ts`
Expected: PASS, 2 testes.

- [ ] **Step 5: Portão do PR 2**

Run: `npx tsc --noEmit && npx prettier --check . && npm test`
Expected: tudo verde. Colar a saída.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts tests/modules/auth/auth.cors.test.ts
git commit -m "feat(cors): restrict allowed origins to the configured list"
```

**PR 2 — corpo:**

```
## What changed
- POST /sessions, POST /sessions/refresh and DELETE /sessions — login, token rotation and logout
- Global onRequest hook — verifies the access token and attaches effective permissions read from the database
- requireAuth() and requirePermission() guards — each route declares its own requirement
- Boot-time onRoute check — the server refuses to start when a route declares no requirement
- Every domain route now requires a module permission — the API is closed
- Existing integration tests authenticate through a shared test helper
- Login attempts are rate limited per address
- CORS origins now come from CORS_ORIGINS instead of a wildcard
- JWT_SECRET and CORS_ORIGINS documented in .example.env and wired into CI

## Dependencies
- @fastify/jwt@10.2.2 — signs and verifies the access token
- @fastify/rate-limit@11.2.0 — bounds login attempts
```

---

# PR 3 — Administração de acesso

Branch: `feat/auth-administration`, a partir de `main` já com o PR 2 mesclado.

### Task 11: `GET /me`

**Files:**

- Modify: `src/modules/auth/auth.routes.ts`
- Test: `tests/modules/auth/me.routes.test.ts`

**Interfaces:**

- Produces: `GET /me` → `{ id, name, email, permissions: Permission[] }`, exige apenas autenticação.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/modules/auth/me.routes.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import { createActor, deleteActor, type TestActor } from "../../helpers/auth.js";
import { Permission } from "../../../src/generated/prisma/index.js";

describe("GET /me", () => {
  let app: FastifyInstance;
  let actor: TestActor;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    actor = await createActor(app, [Permission.STOCK_READ, Permission.PRICING_READ]);
  });

  afterAll(async () => {
    await deleteActor(actor.userId);
    await app.close();
  });

  test("devolve o usuário atual e suas permissões efetivas", async () => {
    const res = await app.inject({ method: "GET", url: "/me", headers: actor.headers });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(actor.userId);
    expect(res.json().permissions.sort()).toEqual([Permission.PRICING_READ, Permission.STOCK_READ].sort());
  });

  test("sem token → 401", async () => {
    expect((await app.inject({ method: "GET", url: "/me" })).statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/modules/auth/me.routes.test.ts`
Expected: FAIL com `404`.

- [ ] **Step 3: Implementar**

Em `src/modules/auth/auth.routes.ts`, acrescentar ao fim de `authRoutes`:

```ts
r.get("/me", { preHandler: requireAuth() }, async (req) => ({
  ...req.auth.user,
  permissions: [...req.auth.permissions],
}));
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/modules/auth/me.routes.test.ts`
Expected: PASS, 2 testes.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth/auth.routes.ts tests/modules/auth/me.routes.test.ts
git commit -m "feat(auth): expose the current user and effective permissions at GET /me"
```

---

### Task 12: CRUD de papéis

**Files:**

- Create: `src/modules/users/roles.schema.ts`
- Create: `src/modules/users/roles.repository.ts`
- Create: `src/modules/users/roles.routes.ts`
- Modify: `src/routes.ts`
- Test: `tests/modules/users/roles.routes.test.ts`

**Interfaces:**

- Produces: `GET /roles`, `POST /roles`, `PATCH /roles/:id`, `DELETE /roles/:id`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/modules/users/roles.routes.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import prisma from "../../../src/lib/prisma.js";
import { createActor, deleteActor, type TestActor } from "../../helpers/auth.js";
import { Permission } from "../../../src/generated/prisma/index.js";

describe("roles routes (integração)", () => {
  let app: FastifyInstance;
  let admin: TestActor;
  let reader: TestActor;
  const createdRoleIds: string[] = [];

  async function createRole(name: string, permissions: Permission[] = [Permission.STOCK_READ]) {
    const res = await app.inject({
      method: "POST",
      url: "/roles",
      headers: admin.headers,
      payload: { name, permissions },
    });
    if (res.statusCode === 201) createdRoleIds.push(res.json().id);
    return res;
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    admin = await createActor(app, [Permission.USERS_READ, Permission.USERS_WRITE]);
    reader = await createActor(app, [Permission.USERS_READ]);
  });

  afterAll(async () => {
    await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
    await deleteActor(admin.userId);
    await deleteActor(reader.userId);
    await app.close();
  });

  test("cria papel com 201", async () => {
    const res = await createRole(`Stock Keeper ${crypto.randomUUID()}`);

    expect(res.statusCode).toBe(201);
    expect(res.json().permissions).toEqual([Permission.STOCK_READ]);
  });

  test("recusa permissão que não existe no enum", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/roles",
      headers: admin.headers,
      payload: { name: "Inválido", permissions: ["STOCK_DESTROY"] },
    });

    expect(res.statusCode).toBe(400);
  });

  test("recusa nome duplicado com 409", async () => {
    const name = `Duplicado ${crypto.randomUUID()}`;
    await createRole(name);

    expect((await createRole(name)).statusCode).toBe(409);
  });

  test("lista traz o papel criado", async () => {
    const created = await createRole(`Listado ${crypto.randomUUID()}`);

    const res = await app.inject({ method: "GET", url: "/roles", headers: admin.headers });

    expect(res.statusCode).toBe(200);
    expect(res.json().map((role: { id: string }) => role.id)).toContain(created.json().id);
  });

  test("edita o pacote de permissões", async () => {
    const created = await createRole(`Editado ${crypto.randomUUID()}`);

    const res = await app.inject({
      method: "PATCH",
      url: `/roles/${created.json().id}`,
      headers: admin.headers,
      payload: { permissions: [Permission.STOCK_READ, Permission.STOCK_WRITE] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().permissions.sort()).toEqual([Permission.STOCK_READ, Permission.STOCK_WRITE].sort());
  });

  test("remove papel e deixa o usuário sem herança", async () => {
    const created = await createRole(`Removido ${crypto.randomUUID()}`);
    const roleId = created.json().id;
    const orphan = await createActor(app, []);
    await prisma.user.update({ where: { id: orphan.userId }, data: { roleId } });

    const res = await app.inject({ method: "DELETE", url: `/roles/${roleId}`, headers: admin.headers });

    expect(res.statusCode).toBe(204);
    expect((await prisma.user.findUnique({ where: { id: orphan.userId } }))?.roleId).toBeNull();

    await deleteActor(orphan.userId);
  });

  test("quem só tem USERS_READ não escreve", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/roles",
      headers: reader.headers,
      payload: { name: "Negado", permissions: [] },
    });

    expect(res.statusCode).toBe(403);
  });

  test("quem não tem USERS_READ não lista", async () => {
    const outsider = await createActor(app, [Permission.STOCK_READ]);

    const res = await app.inject({ method: "GET", url: "/roles", headers: outsider.headers });

    expect(res.statusCode).toBe(403);
    await deleteActor(outsider.userId);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/modules/users/roles.routes.test.ts`
Expected: FAIL com `404`.

- [ ] **Step 3: Implementar o schema**

Criar `src/modules/users/roles.schema.ts`:

```ts
import { z } from "zod";
import { Permission } from "../../generated/prisma/index.js";

export const permissionSchema = z.enum(Permission);

export const createRoleSchema = z.object({
  name: z.string().min(1),
  permissions: z.array(permissionSchema).default([]),
});

export const updateRoleSchema = z.object({
  name: z.string().min(1).optional(),
  permissions: z.array(permissionSchema).optional(),
});

export const roleIdParamSchema = z.object({ id: z.string().uuid() });

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
```

- [ ] **Step 4: Implementar o repositório**

Criar `src/modules/users/roles.repository.ts`:

```ts
import prisma from "../../lib/prisma.js";
import type { CreateRoleInput, UpdateRoleInput } from "./roles.schema.js";

export function listRoles() {
  return prisma.role.findMany({ orderBy: { name: "asc" } });
}

export function createRole(data: CreateRoleInput) {
  return prisma.role.create({ data });
}

export function updateRole(id: string, data: UpdateRoleInput) {
  return prisma.role.update({ where: { id }, data });
}

export function deleteRole(id: string) {
  return prisma.role.delete({ where: { id } });
}
```

- [ ] **Step 5: Implementar as rotas**

Criar `src/modules/users/roles.routes.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { Permission } from "../../generated/prisma/index.js";
import { requirePermission } from "../auth/auth.guard.js";
import { createRoleSchema, roleIdParamSchema, updateRoleSchema } from "./roles.schema.js";
import * as repo from "./roles.repository.js";

export default async function roleRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/roles", { preHandler: requirePermission(Permission.USERS_READ) }, async () => repo.listRoles());

  r.post(
    "/roles",
    { preHandler: requirePermission(Permission.USERS_WRITE), schema: { body: createRoleSchema } },
    async (req, reply) => reply.status(201).send(await repo.createRole(req.body)),
  );

  r.patch(
    "/roles/:id",
    {
      preHandler: requirePermission(Permission.USERS_WRITE),
      schema: { params: roleIdParamSchema, body: updateRoleSchema },
    },
    async (req) => repo.updateRole(req.params.id, req.body),
  );

  r.delete(
    "/roles/:id",
    { preHandler: requirePermission(Permission.USERS_WRITE), schema: { params: roleIdParamSchema } },
    async (req, reply) => {
      await repo.deleteRole(req.params.id);
      return reply.status(204).send();
    },
  );
}
```

- [ ] **Step 6: Tratar nome duplicado como 409**

Em `src/server.ts`, dentro de `errorHandler`, acrescentar antes do `P2003`:

```ts
if (error.code === "P2002") return reply.status(409).send({ message: "Já existe um registro com esse valor único" });
```

- [ ] **Step 7: Registrar as rotas**

Em `src/routes.ts`:

```ts
import roleRoutes from "./modules/users/roles.routes.js";
```

```ts
await app.register(roleRoutes);
```

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `npx vitest run tests/modules/users/roles.routes.test.ts`
Expected: PASS, 8 testes.

- [ ] **Step 9: Commit**

```bash
git add src/modules/users src/routes.ts src/server.ts tests/modules/users/roles.routes.test.ts
git commit -m "feat(roles): manage named permission bundles"
```

---

### Task 13: CRUD de usuários

**Files:**

- Create: `src/modules/users/users.schema.ts`
- Create: `src/modules/users/users.repository.ts`
- Create: `src/modules/users/users.routes.ts`
- Modify: `src/routes.ts`
- Test: `tests/modules/users/users.routes.test.ts`

**Interfaces:**

- Consumes: `hashPassword` (Task 3), `effectivePermissions` (Task 2), `revokeAllRefreshTokens` (Task 5), `permissionSchema` (Task 12).
- Produces: `GET /users`, `POST /users`, `GET /users/:id`, `PATCH /users/:id`, `GET /users/:id/permissions`. Nenhuma resposta inclui `passwordHash`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/modules/users/users.routes.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import prisma from "../../../src/lib/prisma.js";
import { createActor, deleteActor, type TestActor } from "../../helpers/auth.js";
import { Permission } from "../../../src/generated/prisma/index.js";

describe("users routes (integração)", () => {
  let app: FastifyInstance;
  let admin: TestActor;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];

  async function createUser(payload: Record<string, unknown>) {
    const res = await app.inject({ method: "POST", url: "/users", headers: admin.headers, payload });
    if (res.statusCode === 201) createdUserIds.push(res.json().id);
    return res;
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    admin = await createActor(app, [Permission.USERS_READ, Permission.USERS_WRITE]);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
    await deleteActor(admin.userId);
    await app.close();
  });

  test("cria usuário com 201 e nunca devolve o hash da senha", async () => {
    const res = await createUser({
      name: "Novo",
      email: `novo-${crypto.randomUUID()}@example.test`,
      password: "senha-inicial",
      grantedPermissions: [Permission.STOCK_READ],
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).not.toHaveProperty("passwordHash");
    expect(res.json().isActive).toBe(true);
  });

  test("a senha é guardada hasheada", async () => {
    const created = await createUser({
      name: "Hash",
      email: `hash-${crypto.randomUUID()}@example.test`,
      password: "senha-inicial",
    });

    const stored = await prisma.user.findUnique({ where: { id: created.json().id } });

    expect(stored?.passwordHash).not.toBe("senha-inicial");
    expect(stored?.passwordHash.startsWith("scrypt:")).toBe(true);
  });

  test("email duplicado → 409", async () => {
    const email = `dup-${crypto.randomUUID()}@example.test`;
    await createUser({ name: "A", email, password: "senha-inicial" });

    expect((await createUser({ name: "B", email, password: "senha-inicial" })).statusCode).toBe(409);
  });

  test("a lista não vaza hash de senha", async () => {
    const res = await app.inject({ method: "GET", url: "/users", headers: admin.headers });

    expect(res.statusCode).toBe(200);
    for (const user of res.json()) expect(user).not.toHaveProperty("passwordHash");
  });

  test("permissões efetivas somam papel e exceções e respeitam a negação", async () => {
    const role = await prisma.role.create({
      data: {
        name: `Role ${crypto.randomUUID()}`,
        permissions: [Permission.STOCK_READ, Permission.STOCK_WRITE],
      },
    });
    createdRoleIds.push(role.id);

    const created = await createUser({
      name: "Efetivo",
      email: `efetivo-${crypto.randomUUID()}@example.test`,
      password: "senha-inicial",
      roleId: role.id,
      grantedPermissions: [Permission.PRICING_READ],
      deniedPermissions: [Permission.STOCK_WRITE],
    });

    const res = await app.inject({
      method: "GET",
      url: `/users/${created.json().id}/permissions`,
      headers: admin.headers,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().permissions.sort()).toEqual([Permission.PRICING_READ, Permission.STOCK_READ].sort());
  });

  test("desativar revoga os refresh tokens do usuário", async () => {
    const created = await createUser({
      name: "Desligado",
      email: `desligado-${crypto.randomUUID()}@example.test`,
      password: "senha-inicial",
    });
    const userId = created.json().id;
    await prisma.refreshToken.create({
      data: { userId, tokenHash: `hash-${crypto.randomUUID()}`, expiresAt: new Date(Date.now() + 60_000) },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/users/${userId}`,
      headers: admin.headers,
      payload: { isActive: false },
    });

    expect(res.statusCode).toBe(200);
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
  });

  test("usuário inexistente → 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/users/00000000-0000-0000-0000-000000000000",
      headers: admin.headers,
    });

    expect(res.statusCode).toBe(404);
  });

  test("quem não tem USERS_WRITE não cria usuário", async () => {
    const reader = await createActor(app, [Permission.USERS_READ]);

    const res = await app.inject({
      method: "POST",
      url: "/users",
      headers: reader.headers,
      payload: { name: "Negado", email: `negado-${crypto.randomUUID()}@example.test`, password: "senha-inicial" },
    });

    expect(res.statusCode).toBe(403);
    await deleteActor(reader.userId);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/modules/users/users.routes.test.ts`
Expected: FAIL com `404`.

- [ ] **Step 3: Implementar o schema**

Criar `src/modules/users/users.schema.ts`:

```ts
import { z } from "zod";
import { permissionSchema } from "./roles.schema.js";

export const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  roleId: z.string().uuid().nullable().optional(),
  grantedPermissions: z.array(permissionSchema).default([]),
  deniedPermissions: z.array(permissionSchema).default([]),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  roleId: z.string().uuid().nullable().optional(),
  grantedPermissions: z.array(permissionSchema).optional(),
  deniedPermissions: z.array(permissionSchema).optional(),
  isActive: z.boolean().optional(),
});

export const userIdParamSchema = z.object({ id: z.string().uuid() });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
```

- [ ] **Step 4: Implementar o repositório**

Criar `src/modules/users/users.repository.ts`:

```ts
import prisma from "../../lib/prisma.js";
import { hashPassword } from "../auth/auth.password.js";
import type { CreateUserInput, UpdateUserInput } from "./users.schema.js";

/** Tudo menos o hash da senha: nenhuma rota devolve credencial. */
const publicFields = {
  id: true,
  name: true,
  email: true,
  roleId: true,
  grantedPermissions: true,
  deniedPermissions: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function listUsers() {
  return prisma.user.findMany({ select: publicFields, orderBy: { name: "asc" } });
}

export function getUser(id: string) {
  return prisma.user.findUnique({ where: { id }, select: publicFields });
}

export function getUserWithRole(id: string) {
  return prisma.user.findUnique({ where: { id }, select: { ...publicFields, role: true } });
}

export async function createUser(data: CreateUserInput) {
  const { password, ...rest } = data;

  return prisma.user.create({
    data: { ...rest, passwordHash: await hashPassword(password) },
    select: publicFields,
  });
}

export function updateUser(id: string, data: UpdateUserInput) {
  return prisma.user.update({ where: { id }, data, select: publicFields });
}
```

- [ ] **Step 5: Implementar as rotas**

Criar `src/modules/users/users.routes.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { Permission } from "../../generated/prisma/index.js";
import { requirePermission } from "../auth/auth.guard.js";
import { effectivePermissions } from "../auth/auth.permissions.js";
import { revokeAllRefreshTokens } from "../auth/auth.repository.js";
import { createUserSchema, updateUserSchema, userIdParamSchema } from "./users.schema.js";
import * as repo from "./users.repository.js";

export default async function userRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/users", { preHandler: requirePermission(Permission.USERS_READ) }, async () => repo.listUsers());

  r.post(
    "/users",
    { preHandler: requirePermission(Permission.USERS_WRITE), schema: { body: createUserSchema } },
    async (req, reply) => reply.status(201).send(await repo.createUser(req.body)),
  );

  r.get(
    "/users/:id",
    { preHandler: requirePermission(Permission.USERS_READ), schema: { params: userIdParamSchema } },
    async (req, reply) => {
      const user = await repo.getUser(req.params.id);
      if (!user) return reply.status(404).send({ message: "Usuário não encontrado" });
      return user;
    },
  );

  r.patch(
    "/users/:id",
    {
      preHandler: requirePermission(Permission.USERS_WRITE),
      schema: { params: userIdParamSchema, body: updateUserSchema },
    },
    async (req) => {
      const user = await repo.updateUser(req.params.id, req.body);

      // Desativar corta o acesso no request seguinte; a sessão longa morre junto.
      if (req.body.isActive === false) await revokeAllRefreshTokens(user.id);

      return user;
    },
  );

  r.get(
    "/users/:id/permissions",
    { preHandler: requirePermission(Permission.USERS_READ), schema: { params: userIdParamSchema } },
    async (req, reply) => {
      const user = await repo.getUserWithRole(req.params.id);
      if (!user) return reply.status(404).send({ message: "Usuário não encontrado" });

      const permissions = effectivePermissions({
        rolePermissions: user.role?.permissions ?? [],
        grantedPermissions: user.grantedPermissions,
        deniedPermissions: user.deniedPermissions,
      });

      return { userId: user.id, permissions: [...permissions] };
    },
  );
}
```

- [ ] **Step 6: Registrar as rotas**

Em `src/routes.ts`:

```ts
import userRoutes from "./modules/users/users.routes.js";
```

```ts
await app.register(userRoutes);
```

- [ ] **Step 7: Rodar e confirmar que passa**

Run: `npx vitest run tests/modules/users/users.routes.test.ts`
Expected: PASS, 8 testes.

- [ ] **Step 8: Commit**

```bash
git add src/modules/users src/routes.ts tests/modules/users/users.routes.test.ts
git commit -m "feat(users): manage accounts, permission exceptions and deactivation"
```

---

### Task 14: Seed do primeiro usuário e documentação

**Files:**

- Create: `prisma/seed.ts`
- Modify: `package.json`
- Modify: `.example.env`
- Modify: `README.md`
- Test: `tests/prisma/seed.test.ts`

**Interfaces:**

- Produces: `npm run db:seed`, idempotente, cria o papel `Owner` com as 13 permissões e o usuário de `OWNER_EMAIL` / `OWNER_PASSWORD`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/prisma/seed.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import prisma from "../../src/lib/prisma.js";
import { verifyPassword } from "../../src/modules/auth/auth.password.js";
import { Permission } from "../../src/generated/prisma/index.js";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const OWNER_EMAIL = `owner-seed-${crypto.randomUUID()}@example.test`;
const OWNER_PASSWORD = "senha-do-dono";

function runSeed() {
  execFileSync("npm", ["run", "db:seed"], {
    cwd: projectRoot,
    stdio: "pipe",
    env: { ...process.env, OWNER_EMAIL, OWNER_PASSWORD },
  });
}

describe("db:seed", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: OWNER_EMAIL } });
    await prisma.role.deleteMany({ where: { name: "Owner", users: { none: {} } } });
    await prisma.$disconnect();
  });

  test("cria o papel Owner com as 13 permissões e o primeiro usuário", () => {
    runSeed();

    return Promise.all([
      prisma.role.findUnique({ where: { name: "Owner" } }),
      prisma.user.findUnique({ where: { email: OWNER_EMAIL } }),
    ]).then(async ([role, user]) => {
      expect(role?.permissions.sort()).toEqual(Object.values(Permission).sort());
      expect(user?.roleId).toBe(role?.id);
      expect(await verifyPassword(OWNER_PASSWORD, user!.passwordHash)).toBe(true);
    });
  }, 120_000);

  test("rodar de novo não duplica nem quebra", async () => {
    runSeed();

    expect(await prisma.user.count({ where: { email: OWNER_EMAIL } })).toBe(1);
    expect(await prisma.role.count({ where: { name: "Owner" } })).toBe(1);
  }, 120_000);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/prisma/seed.test.ts`
Expected: FAIL — script `db:seed` não existe.

- [ ] **Step 3: Implementar o seed**

Criar `prisma/seed.ts`:

```ts
import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { hashPassword } from "../src/modules/auth/auth.password.js";
import { Permission } from "../src/generated/prisma/index.js";

const ALL_PERMISSIONS = Object.values(Permission);
const OWNER_ROLE_NAME = "Owner";

async function main() {
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;

  if (!email || !password) throw new Error("Defina OWNER_EMAIL e OWNER_PASSWORD para rodar o seed");

  const role = await prisma.role.upsert({
    where: { name: OWNER_ROLE_NAME },
    update: { permissions: ALL_PERMISSIONS },
    create: { name: OWNER_ROLE_NAME, permissions: ALL_PERMISSIONS },
  });

  await prisma.user.upsert({
    where: { email },
    update: { roleId: role.id, isActive: true },
    create: { name: "Owner", email, passwordHash: await hashPassword(password), roleId: role.id },
  });

  console.log(`Seed pronto: papel ${OWNER_ROLE_NAME} e usuário ${email}`);
}

await main();
await prisma.$disconnect();
```

- [ ] **Step 4: Expor o script**

Em `package.json`, acrescentar em `scripts`:

```json
    "db:seed": "tsx prisma/seed.ts",
```

- [ ] **Step 5: Documentar**

Acrescentar a `.example.env`:

```
OWNER_EMAIL="dono@example.com"
OWNER_PASSWORD="troque-esta-senha"
```

No `README.md`, acrescentar uma seção `## Autenticação` com: as variáveis de
ambiente da tabela da spec, o comando `npm run db:seed`, o fluxo
`POST /sessions` → `Authorization: Bearer <accessToken>` →
`POST /sessions/refresh`, a tabela de permissão por rota, e a regra de que toda
rota nova precisa declarar `requirePermission()`, `requireAuth()` ou
`config: { public: true }` sob pena de o servidor não subir.

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `npx vitest run tests/prisma/seed.test.ts`
Expected: PASS, 2 testes.

- [ ] **Step 7: Portão do PR 3**

Run: `npx tsc --noEmit && npx prettier --check . && npm test`
Expected: tudo verde. Colar a saída.

- [ ] **Step 8: Commit**

```bash
git add prisma/seed.ts package.json .example.env README.md tests/prisma/seed.test.ts
git commit -m "feat(seed): bootstrap the owner role and first user"
```

**PR 3 — corpo:**

```
## What changed
- GET /me — current user and effective permissions
- GET, POST, PATCH and DELETE /roles — named permission bundles
- GET, POST, PATCH /users and GET /users/:id/permissions — accounts, exceptions and inspectable effective permissions
- Deactivating a user revokes their refresh tokens
- User responses never include the password hash
- npm run db:seed — bootstraps the Owner role and the first user from OWNER_EMAIL and OWNER_PASSWORD
- README documents the auth flow, the environment variables and the per-route permissions

## Dependencies
- none
```

---

## Riscos e o que fica de fora

- **Janela aberta entre os PRs 1 e 2.** A API só fecha ao fim do PR 2. Não faça
  deploy da `main` entre um e outro.
- **Rotas do `/docs` seguem públicas** porque o swagger-ui é registrado antes do
  `registerAuth`. Isso é intencional e tem teste; se alguém reordenar o
  `buildApp`, o teste de rota pública quebra.
- **Sem recuperação de senha, 2FA, login social, trilha de auditoria ou
  multi-empresa** — fora de escopo por decisão da spec.
- **Sem troca de senha pelo próprio usuário.** O PR 3 cria a senha inicial pela
  mão de quem tem `USERS_WRITE`; trocar a própria senha vira issue à parte.
- **`prisma migrate deploy` precisa rodar antes do deploy** da versão com auth,
  senão toda requisição falha ao carregar o usuário.
