import { afterAll, afterEach, describe, expect, it } from "vitest";
import { resetDatabase, testPrisma } from "./support/database.js";
import { startTestApp } from "./support/app.js";
import { loadEnv } from "../src/lib/env.js";

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

  // A browser asks before sending anything but a plain read, and drops the request when the method
  // is not in the answer: a route with a method left out here works everywhere except on the screen.
  it("lets a browser use every method a route answers to", async () => {
    const { paths } = (await app.inject({ method: "GET", url: "/v1/docs/json" })).json<{
      paths: Record<string, Record<string, unknown>>;
    }>();
    const used = [...new Set(Object.values(paths).flatMap((path) => Object.keys(path)))].map((method) =>
      method.toUpperCase(),
    );

    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/v1/products",
      headers: { origin: loadEnv().CORS_ORIGINS[0], "access-control-request-method": "GET" },
    });
    const allowed = String(preflight.headers["access-control-allow-methods"]).split(/,\s*/);

    expect(allowed).toEqual(expect.arrayContaining(used));
  });

  it("reaches a migrated database", async () => {
    await testPrisma.role.create({ data: { name: "Temporary", permissions: [] } });

    expect(await testPrisma.role.count()).toBe(1);
  });

  it("starts each test from an empty database", async () => {
    expect(await testPrisma.role.count()).toBe(0);
  });
});
