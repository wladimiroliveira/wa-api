import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import prisma from "../../../src/lib/prisma.js";
import { hashPassword } from "../../../src/modules/auth/auth.password.js";

describe("limite de tentativas no login", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Precisa vir antes do buildApp: os limites são lidos no registro das rotas.
    process.env.LOGIN_RATE_LIMIT_MAX = "5";
    process.env.REFRESH_RATE_LIMIT_MAX = "3";
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env.LOGIN_RATE_LIMIT_MAX = "1000";
    process.env.REFRESH_RATE_LIMIT_MAX = "1000";
  });

  test("bloqueia com 429 depois de seis tentativas do mesmo IP", async () => {
    const attempt = () =>
      app.inject({
        method: "POST",
        url: "/sessions",
        remoteAddress: "203.0.113.7",
        payload: { username: "forca-bruta", password: "chute" },
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

describe("limite de tentativas no refresh", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.LOGIN_RATE_LIMIT_MAX = "5";
    process.env.REFRESH_RATE_LIMIT_MAX = "3";
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env.LOGIN_RATE_LIMIT_MAX = "1000";
    process.env.REFRESH_RATE_LIMIT_MAX = "1000";
  });

  test("bloqueia com 429 depois de quatro tentativas do mesmo IP", async () => {
    const attempt = () =>
      app.inject({
        method: "POST",
        url: "/sessions/refresh",
        remoteAddress: "198.51.100.9",
        payload: { refreshToken: "invalido" },
      });

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await attempt()).statusCode);

    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses[3]).toBe(429);
  });

  test("o login não é afetado pelo limite do refresh", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      remoteAddress: "198.51.100.9",
      payload: { username: "nao-existe", password: "chute" },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("limite de tentativas na troca da própria senha", () => {
  let app: FastifyInstance;
  let userId: string;
  let headers: { authorization: string };

  beforeAll(async () => {
    process.env.LOGIN_RATE_LIMIT_MAX = "5";
    app = await buildApp();
    await app.ready();

    const username = `limite-${crypto.randomUUID().slice(0, 8)}`;
    const user = await prisma.user.create({
      data: {
        name: "Limite",
        username,
        email: `${username}@example.test`,
        passwordHash: await hashPassword("senha-atual-1"),
      },
    });
    userId = user.id;
    headers = { authorization: `Bearer ${app.jwt.sign({ sub: user.id })}` };
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await app.close();
    process.env.LOGIN_RATE_LIMIT_MAX = "1000";
  });

  test("bloqueia com 429 depois de seis chutes da senha atual", async () => {
    const attempt = () =>
      app.inject({
        method: "PATCH",
        url: "/me/password",
        headers,
        remoteAddress: "192.0.2.11",
        payload: { currentPassword: "chute", newPassword: "senha-nova-12" },
      });

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await attempt()).statusCode);

    expect(statuses.slice(0, 5)).toEqual([403, 403, 403, 403, 403]);
    expect(statuses[5]).toBe(429);
  });

  test("o login não é afetado pelo limite da troca de senha", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      remoteAddress: "192.0.2.11",
      payload: { username: "nao-existe", password: "chute" },
    });

    expect(res.statusCode).toBe(401);
  });
});
