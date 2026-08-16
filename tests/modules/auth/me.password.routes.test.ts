import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import prisma from "../../../src/lib/prisma.js";
import { hashPassword } from "../../../src/modules/auth/auth.password.js";

const CURRENT_PASSWORD = "senha-atual-1";
const NEW_PASSWORD = "senha-nova-12";

describe("PATCH /me/password", () => {
  let app: FastifyInstance;
  const createdUserIds: string[] = [];

  /** Ator com senha conhecida: o teste precisa logar antes e depois da troca. */
  async function createUserWithPassword() {
    const username = `trocasenha-${crypto.randomUUID().slice(0, 8)}`;
    const user = await prisma.user.create({
      data: {
        name: "Troca Senha",
        username,
        email: `${username}@example.test`,
        passwordHash: await hashPassword(CURRENT_PASSWORD),
      },
    });
    createdUserIds.push(user.id);

    return { id: user.id, username, headers: { authorization: `Bearer ${app.jwt.sign({ sub: user.id })}` } };
  }

  function login(username: string, password: string) {
    return app.inject({ method: "POST", url: "/sessions", payload: { username, password } });
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  });

  test("troca a senha com 204 e a senha nova passa a valer", async () => {
    const actor = await createUserWithPassword();

    const res = await app.inject({
      method: "PATCH",
      url: "/me/password",
      headers: actor.headers,
      payload: { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD },
    });

    expect(res.statusCode).toBe(204);
    expect((await login(actor.username, NEW_PASSWORD)).statusCode).toBe(200);
  });

  test("a senha antiga deixa de valer", async () => {
    const actor = await createUserWithPassword();

    await app.inject({
      method: "PATCH",
      url: "/me/password",
      headers: actor.headers,
      payload: { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD },
    });

    expect((await login(actor.username, CURRENT_PASSWORD)).statusCode).toBe(401);
  });

  test("derruba as sessões existentes: refresh token roubado não sobrevive à troca", async () => {
    const actor = await createUserWithPassword();
    await prisma.refreshToken.create({
      data: { userId: actor.id, tokenHash: `hash-${crypto.randomUUID()}`, expiresAt: new Date(Date.now() + 60_000) },
    });

    const res = await app.inject({
      method: "PATCH",
      url: "/me/password",
      headers: actor.headers,
      payload: { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD },
    });

    expect(res.statusCode).toBe(204);
    expect(await prisma.refreshToken.count({ where: { userId: actor.id, revokedAt: null } })).toBe(0);
  });

  test("limpa os cookies de sessão junto", async () => {
    const actor = await createUserWithPassword();

    const res = await app.inject({
      method: "PATCH",
      url: "/me/password",
      headers: actor.headers,
      payload: { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD },
    });

    expect(res.cookies.map((cookie) => cookie.name).sort()).toEqual(["csrfToken", "refreshToken"]);
    for (const cookie of res.cookies) expect(cookie.value).toBe("");
  });

  test("senha atual errada → 403 e a senha continua a mesma", async () => {
    const actor = await createUserWithPassword();

    const res = await app.inject({
      method: "PATCH",
      url: "/me/password",
      headers: actor.headers,
      payload: { currentPassword: "senha-errada", newPassword: NEW_PASSWORD },
    });

    expect(res.statusCode).toBe(403);
    expect((await login(actor.username, CURRENT_PASSWORD)).statusCode).toBe(200);
  });

  test("senha nova com menos de 8 caracteres → 400", async () => {
    const actor = await createUserWithPassword();

    const res = await app.inject({
      method: "PATCH",
      url: "/me/password",
      headers: actor.headers,
      payload: { currentPassword: CURRENT_PASSWORD, newPassword: "curta" },
    });

    expect(res.statusCode).toBe(400);
  });

  test("sem token → 401", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/me/password",
      payload: { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD },
    });

    expect(res.statusCode).toBe(401);
  });
});
