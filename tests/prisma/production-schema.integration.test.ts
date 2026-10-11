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

async function createProduction() {
  const user = await createUser();

  return testPrisma.production.create({ data: { createdById: user.id } });
}

type ItemOverrides = { expectedQuantity?: string; producedQuantity?: string; unitCost?: string };

async function itemInput(overrides: ItemOverrides = {}) {
  const [production, dough] = await Promise.all([createProduction(), createProduct("Bread dough", "MANUFACTURED")]);

  return { productionId: production.id, productSku: dough.sku, expectedQuantity: "50", ...overrides };
}

async function inputInput(overrides: { quantity?: string; unitCost?: string } = {}) {
  const [item, flour] = await Promise.all([
    testPrisma.productionItem.create({ data: await itemInput() }),
    createProduct("Wheat flour"),
  ]);

  return { productionItemId: item.id, productSku: flour.sku, quantity: "30", ...overrides };
}

describe("productions", () => {
  it("starts in progress, with no finish time", async () => {
    const production = await createProduction();

    expect(production.status).toBe("IN_PROGRESS");
    expect(production.finishedAt).toBeNull();
  });

  it("rejects a finished production with no finish time, and a finish time on one in progress", async () => {
    const production = await createProduction();
    const update = (data: { status?: "FINISHED"; finishedAt?: Date }) =>
      testPrisma.production.update({ where: { id: production.id }, data });

    await expect(update({ status: "FINISHED" })).rejects.toThrow(/ck_productions_finished_at_matches_status/);
    await expect(update({ finishedAt: new Date() })).rejects.toThrow(/ck_productions_finished_at_matches_status/);
    await expect(update({ status: "FINISHED", finishedAt: new Date() })).resolves.toMatchObject({
      status: "FINISHED",
    });
  });

  it("rejects a canceled production with no cancel time, and a cancel time on one in progress", async () => {
    const production = await createProduction();
    const update = (data: { status?: "CANCELED"; canceledAt?: Date }) =>
      testPrisma.production.update({ where: { id: production.id }, data });

    await expect(update({ status: "CANCELED" })).rejects.toThrow(/ck_productions_canceled_at_matches_status/);
    await expect(update({ canceledAt: new Date() })).rejects.toThrow(/ck_productions_canceled_at_matches_status/);
    await expect(update({ status: "CANCELED", canceledAt: new Date() })).resolves.toMatchObject({
      status: "CANCELED",
    });
  });

  it("refuses to delete a user a production refers to", async () => {
    const production = await createProduction();

    await expect(testPrisma.user.delete({ where: { id: production.createdById } })).rejects.toThrow();
  });
});

describe("production_items", () => {
  it("records the expected quantity and leaves the produced one and its cost unknown", async () => {
    const item = await testPrisma.productionItem.create({ data: await itemInput() });

    expect(item.expectedQuantity.toString()).toBe("50");
    expect(item.producedQuantity).toBeNull();
    expect(item.unitCost).toBeNull();
  });

  it.each([
    [
      "an expected quantity that is not positive",
      { expectedQuantity: "0" },
      /ck_production_items_expected_quantity_positive/,
    ],
    [
      "a produced quantity that is not positive",
      { producedQuantity: "0" },
      /ck_production_items_produced_quantity_positive/,
    ],
    ["a negative unit cost", { unitCost: "-1" }, /ck_production_items_unit_cost_non_negative/],
  ])("rejects %s", async (_label, overrides: ItemOverrides, constraint) => {
    const data = await itemInput(overrides);

    await expect(testPrisma.productionItem.create({ data })).rejects.toThrow(constraint);
  });

  it("rejects a pre-weighing that already guides another item", async () => {
    const data = await itemInput();
    const preWeighing = await testPrisma.preWeighing.create({
      data: { productSku: data.productSku, createdById: (await testPrisma.user.findFirstOrThrow()).id, quantity: "50" },
    });
    await testPrisma.productionItem.create({ data: { ...data, preWeighingId: preWeighing.id } });

    await expect(
      testPrisma.productionItem.create({ data: { ...data, preWeighingId: preWeighing.id } }),
    ).rejects.toThrow();
  });

  it("refuses to delete a product or a production an item refers to", async () => {
    const data = await itemInput();
    await testPrisma.productionItem.create({ data });

    await expect(testPrisma.product.delete({ where: { sku: data.productSku } })).rejects.toThrow();
    await expect(testPrisma.production.delete({ where: { id: data.productionId } })).rejects.toThrow();
  });
});

describe("production_item_inputs", () => {
  it("records the quantity and leaves the cost unknown", async () => {
    const input = await testPrisma.productionItemInput.create({ data: await inputInput() });

    expect(input.quantity.toString()).toBe("30");
    expect(input.unitCost).toBeNull();
  });

  it("rejects a quantity that is not positive", async () => {
    const data = await inputInput({ quantity: "0" });

    await expect(testPrisma.productionItemInput.create({ data })).rejects.toThrow(
      /ck_production_item_inputs_quantity_positive/,
    );
  });

  it("rejects a negative unit cost", async () => {
    const data = await inputInput({ unitCost: "-1" });

    await expect(testPrisma.productionItemInput.create({ data })).rejects.toThrow(
      /ck_production_item_inputs_unit_cost_non_negative/,
    );
  });

  it("rejects the same product twice in an item", async () => {
    const data = await inputInput();
    await testPrisma.productionItemInput.create({ data });

    await expect(testPrisma.productionItemInput.create({ data })).rejects.toThrow();
  });

  it("refuses to delete a product or an item an input refers to", async () => {
    const data = await inputInput();
    await testPrisma.productionItemInput.create({ data });

    await expect(testPrisma.product.delete({ where: { sku: data.productSku } })).rejects.toThrow();
    await expect(testPrisma.productionItem.delete({ where: { id: data.productionItemId } })).rejects.toThrow();
  });
});
