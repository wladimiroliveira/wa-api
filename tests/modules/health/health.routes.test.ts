import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import prisma from "../../../src/lib/prisma.js";

describe("health routes (integração)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  test("banco respondendo → 200 com status ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", database: "up" });
  });

  test("banco indisponível → 503 com status error", async () => {
    const ping = vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("connection refused"));

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "error", database: "down" });

    ping.mockRestore();
  });
});
