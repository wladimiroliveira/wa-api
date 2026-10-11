import { afterAll, afterEach, describe, expect, it } from "vitest";
import { resetDatabase, testPrisma } from "../support/database.js";

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createProduct = (description: string, kind: "GOODS" | "MANUFACTURED" = "GOODS") =>
  testPrisma.product.create({ data: { description, kind, unit: "KILOGRAM" } });

const createUser = () => testPrisma.user.create({ data: { name: "Someone", username: "someone", passwordHash: "x" } });

async function createPreWeighing(quantity = "50") {
  const [product, user] = await Promise.all([createProduct("Bread dough", "MANUFACTURED"), createUser()]);

  return testPrisma.preWeighing.create({ data: { productSku: product.sku, createdById: user.id, quantity } });
}

async function itemInput(overrides: { plannedQuantity?: string; weighedQuantity?: string } = {}) {
  const [preWeighing, flour] = await Promise.all([createPreWeighing(), createProduct("Wheat flour")]);

  return {
    preWeighingId: preWeighing.id,
    productSku: flour.sku,
    plannedQuantity: overrides.plannedQuantity ?? "30",
    weighedQuantity: overrides.weighedQuantity ?? "30.2",
  };
}

describe("pre_weighings", () => {
  it("records the product, the quantity to produce and the author", async () => {
    const preWeighing = await createPreWeighing();

    expect(preWeighing.quantity.toString()).toBe("50");
    expect(preWeighing.createdAt).toBeInstanceOf(Date);
  });

  it("rejects a quantity that is not positive", async () => {
    await expect(createPreWeighing("0")).rejects.toThrow(/ck_pre_weighings_quantity_positive/);
  });

  it("refuses to delete a product or a user a pre-weighing refers to", async () => {
    const preWeighing = await createPreWeighing();

    await expect(testPrisma.product.delete({ where: { sku: preWeighing.productSku } })).rejects.toThrow();
    await expect(testPrisma.user.delete({ where: { id: preWeighing.createdById } })).rejects.toThrow();
  });
});

describe("pre_weighing_items", () => {
  it("records the planned and the weighed quantity of a product", async () => {
    const item = await testPrisma.preWeighingItem.create({ data: await itemInput() });

    expect(item.plannedQuantity.toString()).toBe("30");
    expect(item.weighedQuantity.toString()).toBe("30.2");
  });

  it("rejects a planned quantity that is not positive", async () => {
    const data = await itemInput({ plannedQuantity: "0" });

    await expect(testPrisma.preWeighingItem.create({ data })).rejects.toThrow(
      /ck_pre_weighing_items_planned_quantity_positive/,
    );
  });

  it("rejects a weighed quantity that is not positive", async () => {
    const data = await itemInput({ weighedQuantity: "0" });

    await expect(testPrisma.preWeighingItem.create({ data })).rejects.toThrow(
      /ck_pre_weighing_items_weighed_quantity_positive/,
    );
  });

  it("rejects the same product twice in a pre-weighing", async () => {
    const data = await itemInput();
    await testPrisma.preWeighingItem.create({ data });

    await expect(testPrisma.preWeighingItem.create({ data })).rejects.toThrow();
  });

  it("refuses to delete a product or a pre-weighing an item refers to", async () => {
    const data = await itemInput();
    await testPrisma.preWeighingItem.create({ data });

    await expect(testPrisma.product.delete({ where: { sku: data.productSku } })).rejects.toThrow();
    await expect(testPrisma.preWeighing.delete({ where: { id: data.preWeighingId } })).rejects.toThrow();
  });
});
