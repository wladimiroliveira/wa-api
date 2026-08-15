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
