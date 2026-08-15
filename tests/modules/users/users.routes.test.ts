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
      username: `novo-${crypto.randomUUID().slice(0, 8)}`,
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
      username: `hash-${crypto.randomUUID().slice(0, 8)}`,
      email: `hash-${crypto.randomUUID()}@example.test`,
      password: "senha-inicial",
    });

    const stored = await prisma.user.findUnique({ where: { id: created.json().id } });

    expect(stored?.passwordHash).not.toBe("senha-inicial");
    expect(stored?.passwordHash.startsWith("scrypt:")).toBe(true);
  });

  test("email duplicado → 409", async () => {
    const email = `dup-${crypto.randomUUID()}@example.test`;
    await createUser({ name: "A", username: `a-${crypto.randomUUID().slice(0, 8)}`, email, password: "senha-inicial" });

    expect(
      (
        await createUser({
          name: "B",
          username: `b-${crypto.randomUUID().slice(0, 8)}`,
          email,
          password: "senha-inicial",
        })
      ).statusCode,
    ).toBe(409);
  });

  test("username duplicado → 409, mesmo com caixa diferente", async () => {
    const username = `dup-${crypto.randomUUID().slice(0, 8)}`;
    await createUser({
      name: "A",
      username,
      email: `a-${crypto.randomUUID()}@example.test`,
      password: "senha-inicial",
    });

    const res = await createUser({
      name: "B",
      username: username.toUpperCase(),
      email: `b-${crypto.randomUUID()}@example.test`,
      password: "senha-inicial",
    });

    expect(res.statusCode).toBe(409);
  });

  test("recusa username com caractere inválido", async () => {
    const res = await createUser({
      name: "Inválido",
      username: "maria souza",
      email: `invalido-${crypto.randomUUID()}@example.test`,
      password: "senha-inicial",
    });

    expect(res.statusCode).toBe(400);
  });

  test("grava o username normalizado em minúsculas", async () => {
    const username = `Maiuscula-${crypto.randomUUID().slice(0, 8)}`;
    const created = await createUser({
      name: "Caixa",
      username,
      email: `caixa-${crypto.randomUUID()}@example.test`,
      password: "senha-inicial",
    });

    expect(created.json().username).toBe(username.toLowerCase());
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
      username: `efetivo-${crypto.randomUUID().slice(0, 8)}`,
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
      username: `desligado-${crypto.randomUUID().slice(0, 8)}`,
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
      payload: {
        name: "Negado",
        username: `negado-${crypto.randomUUID().slice(0, 8)}`,
        email: `negado-${crypto.randomUUID()}@example.test`,
        password: "senha-inicial",
      },
    });

    expect(res.statusCode).toBe(403);
    await deleteActor(reader.userId);
  });
});
