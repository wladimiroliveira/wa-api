import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import prisma from "../../../src/lib/prisma.js";
import { hashPassword } from "../../../src/modules/auth/auth.password.js";
import { createActor, deleteActor, type TestActor } from "../../helpers/auth.js";
import { Permission } from "../../../src/generated/prisma/index.js";

const CURRENT_PASSWORD = "senha-atual-1";
const NEW_PASSWORD = "senha-nova-12";

describe("PATCH /users/:id/password", () => {
  let app: FastifyInstance;
  let admin: TestActor;
  const createdUserIds: string[] = [];

  /** Alvo do reset com senha conhecida: o teste confere o login antes e depois. */
  async function createTargetUser() {
    const username = `esquecido-${crypto.randomUUID().slice(0, 8)}`;
    const user = await prisma.user.create({
      data: {
        name: "Esquecido",
        username,
        email: `${username}@example.test`,
        passwordHash: await hashPassword(CURRENT_PASSWORD),
      },
    });
    createdUserIds.push(user.id);

    return { id: user.id, username };
  }

  function login(username: string, password: string) {
    return app.inject({ method: "POST", url: "/sessions", payload: { username, password } });
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    admin = await createActor(app, [Permission.USERS_READ, Permission.USERS_WRITE]);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await deleteActor(admin.userId);
    await app.close();
  });

  test("reseta a senha de outro com 204, sem conhecer a senha atual", async () => {
    const target = await createTargetUser();

    const res = await app.inject({
      method: "PATCH",
      url: `/users/${target.id}/password`,
      headers: admin.headers,
      payload: { newPassword: NEW_PASSWORD },
    });

    expect(res.statusCode).toBe(204);
    expect((await login(target.username, NEW_PASSWORD)).statusCode).toBe(200);
    expect((await login(target.username, CURRENT_PASSWORD)).statusCode).toBe(401);
  });

  test("a senha é guardada hasheada", async () => {
    const target = await createTargetUser();

    await app.inject({
      method: "PATCH",
      url: `/users/${target.id}/password`,
      headers: admin.headers,
      payload: { newPassword: NEW_PASSWORD },
    });

    const stored = await prisma.user.findUnique({ where: { id: target.id } });

    expect(stored?.passwordHash).not.toBe(NEW_PASSWORD);
    expect(stored?.passwordHash.startsWith("scrypt:")).toBe(true);
  });

  test("derruba as sessões do usuário resetado", async () => {
    const target = await createTargetUser();
    await prisma.refreshToken.create({
      data: { userId: target.id, tokenHash: `hash-${crypto.randomUUID()}`, expiresAt: new Date(Date.now() + 60_000) },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/users/${target.id}/password`,
      headers: admin.headers,
      payload: { newPassword: NEW_PASSWORD },
    });

    expect(res.statusCode).toBe(204);
    expect(await prisma.refreshToken.count({ where: { userId: target.id, revokedAt: null } })).toBe(0);
  });

  test("quem não tem USERS_WRITE não reseta senha alheia", async () => {
    const target = await createTargetUser();
    const reader = await createActor(app, [Permission.USERS_READ]);

    const res = await app.inject({
      method: "PATCH",
      url: `/users/${target.id}/password`,
      headers: reader.headers,
      payload: { newPassword: NEW_PASSWORD },
    });

    expect(res.statusCode).toBe(403);
    expect((await login(target.username, CURRENT_PASSWORD)).statusCode).toBe(200);
    await deleteActor(reader.userId);
  });

  test("usuário inexistente → 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/users/00000000-0000-0000-0000-000000000000/password",
      headers: admin.headers,
      payload: { newPassword: NEW_PASSWORD },
    });

    expect(res.statusCode).toBe(404);
  });

  test("senha nova com menos de 8 caracteres → 400", async () => {
    const target = await createTargetUser();

    const res = await app.inject({
      method: "PATCH",
      url: `/users/${target.id}/password`,
      headers: admin.headers,
      payload: { newPassword: "curta" },
    });

    expect(res.statusCode).toBe(400);
  });

  test("a rota não devolve corpo nenhum, muito menos o hash", async () => {
    const target = await createTargetUser();

    const res = await app.inject({
      method: "PATCH",
      url: `/users/${target.id}/password`,
      headers: admin.headers,
      payload: { newPassword: NEW_PASSWORD },
    });

    expect(res.body).toBe("");
  });
});
