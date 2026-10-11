import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findSchemaConventionViolations } from "../../scripts/schema-convention.js";

const SCHEMA = readFileSync(fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)), "utf8");

function enumValues(name: string): string[] {
  const block = new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`).exec(SCHEMA);
  expect(block).not.toBeNull();

  return block![1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("@@"));
}

const productField = (pattern: string) => new RegExp(`model Product \\{[^}]*?\\n\\s+${pattern}[^}]*?\\n\\}`);

describe("catalog schema", () => {
  it("keeps goods and manufactured products in a single table", () => {
    expect(SCHEMA).toMatch(/model Product \{[\s\S]*?@@map\("products"\)/);
    expect(enumValues("ProductKind").sort()).toEqual(["GOODS", "MANUFACTURED"]);
    expect(SCHEMA).toMatch(/enum ProductKind \{[\s\S]*?@@map\("product_kind"\)/);
    expect(SCHEMA).toMatch(productField(String.raw`kind\s+ProductKind\b`));
  });

  it("identifies a product by its SKU, a UUIDv7 primary key", () => {
    expect(SCHEMA).toMatch(productField(String.raw`sku\s+String\s+@id @default\(uuid\(7\)\) @db\.Uuid`));
    expect(SCHEMA).not.toMatch(productField(String.raw`id\s+String`));
  });

  it("gives a SKU at most one GTIN, and a GTIN at most one SKU", () => {
    expect(SCHEMA).toMatch(productField(String.raw`gtin\s+String\?\s+@unique`));
  });

  it("measures a product in a single unit from a fixed set", () => {
    expect(enumValues("MeasurementUnit").sort()).toEqual(["GRAM", "KILOGRAM", "LITER", "MILLILITER", "UNIT"]);
    expect(SCHEMA).toMatch(/enum MeasurementUnit \{[\s\S]*?@@map\("measurement_unit"\)/);
    expect(SCHEMA).toMatch(productField(String.raw`unit\s+MeasurementUnit\b`));
  });

  it("deactivates a product instead of deleting it", () => {
    expect(SCHEMA).toMatch(productField(String.raw`isActive\s+Boolean\s+@default\(true\)\s+@map\("is_active"\)`));
  });

  it("violates no rule of the table convention", () => {
    expect(findSchemaConventionViolations(SCHEMA)).toEqual([]);
  });
});
