import { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Permission } from "../../../src/generated/prisma/index.js";
import { authenticateAs, startTestApp } from "../../support/app.js";
import { resetDatabase, testPrisma } from "../../support/database.js";

let app: FastifyInstance;

beforeEach(async () => {
  app = await startTestApp();
});

afterEach(async () => {
  await app.close();
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const listProducts = (headers: { authorization: string } | undefined) =>
  app.inject({ method: "GET", url: "/v1/products", headers });

describe("GET /v1/products", () => {
  it("lists every product by description, with what a screen needs to pick one", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_READ]);
    const flour = await testPrisma.product.create({
      data: { description: "Wheat flour", kind: "GOODS", unit: "KILOGRAM", gtin: "7891000100103" },
    });
    const bread = await testPrisma.product.create({
      data: { description: "Bread", kind: "MANUFACTURED", unit: "UNIT", isActive: false },
    });

    const response = await listProducts(headers);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { sku: bread.sku, gtin: null, description: "Bread", kind: "MANUFACTURED", unit: "UNIT", isActive: false },
      {
        sku: flour.sku,
        gtin: "7891000100103",
        description: "Wheat flour",
        kind: "GOODS",
        unit: "KILOGRAM",
        isActive: true,
      },
    ]);
  });

  it("answers an empty list when the catalog is empty", async () => {
    const { headers } = await authenticateAs(app, [Permission.CATALOG_READ]);

    expect((await listProducts(headers)).json()).toEqual([]);
  });

  it("answers 403 without CATALOG_READ", async () => {
    const { headers } = await authenticateAs(app, [Permission.ENTRIES_CREATE]);

    expect((await listProducts(headers)).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await listProducts(undefined)).statusCode).toBe(401);
  });
});
