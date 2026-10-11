import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCHEMA = readFileSync(fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)), "utf8");

const fieldOf = (model: string, pattern: string) => new RegExp(`model ${model} \\{[^}]*?\\n\\s+${pattern}[^}]*?\\n\\}`);

describe("stock schema", () => {
  it("declares the stock and the movement tables", () => {
    expect(SCHEMA).toMatch(/model ProductStock \{[\s\S]*?@@map\("product_stocks"\)/);
    expect(SCHEMA).toMatch(/model StockMovement \{[\s\S]*?@@map\("stock_movements"\)/);
  });

  it("keys the stock by the product's SKU, so a product has a single balance", () => {
    expect(SCHEMA).toMatch(
      fieldOf("ProductStock", String.raw`productSku\s+String\s+@id @map\("product_sku"\) @db\.Uuid`),
    );
  });

  it("keeps the last entry cost, the average cost and the minimum quantity optional", () => {
    expect(SCHEMA).toMatch(fieldOf("ProductStock", String.raw`lastEntryCost\s+Decimal\?\s+@map\("last_entry_cost"\)`));
    expect(SCHEMA).toMatch(fieldOf("ProductStock", String.raw`averageCost\s+Decimal\?\s+@map\("average_cost"\)`));
    expect(SCHEMA).toMatch(
      fieldOf("ProductStock", String.raw`minimumQuantity\s+Decimal\?\s+@map\("minimum_quantity"\)`),
    );
  });

  it("knows the entry and the two movements of a production", () => {
    const block = /enum StockMovementType \{([\s\S]*?)\n\}/.exec(SCHEMA);
    expect(block).not.toBeNull();

    const values = block![1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("@@"));

    expect(values).toEqual(["ENTRY", "PRODUCTION_CONSUMPTION", "PRODUCTION_OUTPUT"]);
    expect(SCHEMA).toMatch(/enum StockMovementType \{[\s\S]*?@@map\("stock_movement_type"\)/);
  });

  it("snapshots the unit cost and the author on every movement", () => {
    expect(SCHEMA).toMatch(
      fieldOf("StockMovement", String.raw`unitCost\s+Decimal\s+@map\("unit_cost"\) @db\.Decimal\(18, 6\)`),
    );
    expect(SCHEMA).toMatch(
      fieldOf("StockMovement", String.raw`createdById\s+String\s+@map\("created_by_id"\) @db\.Uuid`),
    );
  });

  it("indexes the movements of a product for cursor pagination", () => {
    expect(SCHEMA).toContain(
      `@@index([productSku, createdAt(sort: Desc), id(sort: Desc)], map: "idx_stock_movements_product_sku_created_at")`,
    );
  });
});
