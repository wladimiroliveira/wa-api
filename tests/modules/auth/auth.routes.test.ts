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
  let username: string;
  let userId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    username = `session-${crypto.randomUUID().slice(0, 8)}`;
    const user = await prisma.user.create({
      data: {
        name: "Session User",
        username,
        email: `${username}@example.test`,
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

  /** Modo corpo: o caminho dos clientes não-navegador, que é o coberto aqui. */
  async function login() {
    return app.inject({
      method: "POST",
      url: "/sessions",
      headers: { "x-refresh-delivery": "body" },
      payload: { username, password: PASSWORD },
    });
  }

  test("login devolve access e refresh token", async () => {
    const res = await login();

    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toEqual(expect.any(String));
    expect(res.json().refreshToken).toEqual(expect.any(String));
  });

  test("login não depende da caixa do username", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { username: username.toUpperCase(), password: PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toEqual(expect.any(String));
  });

  test("login com senha errada → 401", async () => {
    const res = await app.inject({ method: "POST", url: "/sessions", payload: { username, password: "errada" } });

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
