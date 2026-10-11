import { afterAll, afterEach, describe, expect, it } from "vitest";
import { resetDatabase, testPrisma } from "../support/database.js";

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createProduct = () =>
  testPrisma.product.create({ data: { description: "Wheat flour", kind: "GOODS", unit: "KILOGRAM" } });

const createUser = () => testPrisma.user.create({ data: { name: "Someone", username: "someone", passwordHash: "x" } });

async function movementInput(overrides: { quantity?: string; unitCost?: string } = {}) {
  const [product, user] = await Promise.all([createProduct(), createUser()]);

  return {
    productSku: product.sku,
    createdById: user.id,
    type: "ENTRY" as const,
    quantity: overrides.quantity ?? "10",
    unitCost: overrides.unitCost ?? "4.5",
  };
}

describe("product_stocks", () => {
  it("starts empty, with no cost and no minimum", async () => {
    const product = await createProduct();

    const stock = await testPrisma.productStock.create({ data: { productSku: product.sku } });

    expect(stock.quantity.toString()).toBe("0");
    expect(stock.lastEntryCost).toBeNull();
    expect(stock.averageCost).toBeNull();
    expect(stock.minimumQuantity).toBeNull();
  });

  it("holds a single balance per product", async () => {
    const product = await createProduct();
    await testPrisma.productStock.create({ data: { productSku: product.sku } });

    await expect(testPrisma.productStock.create({ data: { productSku: product.sku } })).rejects.toThrow();
  });

  it("accepts a negative balance, so a wrong movement never blocks the flow", async () => {
    const product = await createProduct();

    const stock = await testPrisma.productStock.create({ data: { productSku: product.sku, quantity: "-3" } });

    expect(stock.quantity.toString()).toBe("-3");
  });
});

describe("stock_movements", () => {
  it("records an entry with its quantity, unit cost and author", async () => {
    const input = await movementInput();

    const movement = await testPrisma.stockMovement.create({ data: input });

    expect(movement).toMatchObject({ productSku: input.productSku, createdById: input.createdById, type: "ENTRY" });
    expect(movement.quantity.toString()).toBe("10");
    expect(movement.unitCost.toString()).toBe("4.5");
  });

  it("rejects a quantity that is not positive", async () => {
    const input = await movementInput({ quantity: "0" });

    await expect(testPrisma.stockMovement.create({ data: input })).rejects.toThrow(
      /ck_stock_movements_quantity_positive/,
    );
  });

  it("rejects a negative unit cost", async () => {
    const input = await movementInput({ unitCost: "-1" });

    await expect(testPrisma.stockMovement.create({ data: input })).rejects.toThrow(
      /ck_stock_movements_unit_cost_non_negative/,
    );
  });

  it("refuses to delete a product or a user a movement refers to", async () => {
    const input = await movementInput();
    await testPrisma.stockMovement.create({ data: input });

    await expect(testPrisma.product.delete({ where: { sku: input.productSku } })).rejects.toThrow();
    await expect(testPrisma.user.delete({ where: { id: input.createdById } })).rejects.toThrow();
  });
});
