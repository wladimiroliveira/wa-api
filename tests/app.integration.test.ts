import { afterAll, afterEach, describe, expect, it } from "vitest";
import { resetDatabase, testPrisma } from "./support/database.js";
import { startTestApp } from "./support/app.js";

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

  it("reaches a migrated database", async () => {
    await testPrisma.role.create({ data: { name: "Temporary", permissions: [] } });

    expect(await testPrisma.role.count()).toBe(1);
  });

  it("starts each test from an empty database", async () => {
    expect(await testPrisma.role.count()).toBe(0);
  });
});
