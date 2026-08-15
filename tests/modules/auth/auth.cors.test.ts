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
