import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findSchemaConventionViolations } from "../../scripts/schema-convention.js";

const SCHEMA = readFileSync(fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)), "utf8");

const fieldOf = (model: string, pattern: string) => new RegExp(`model ${model} \\{[^}]*?\\n\\s+${pattern}[^}]*?\\n\\}`);

describe("pre-weighing schema", () => {
  it("declares the pre-weighing and the item tables", () => {
    expect(SCHEMA).toMatch(/model PreWeighing \{[\s\S]*?@@map\("pre_weighings"\)/);
    expect(SCHEMA).toMatch(/model PreWeighingItem \{[\s\S]*?@@map\("pre_weighing_items"\)/);
  });

  it("records how much of the product is to be produced, and who weighed for it", () => {
    expect(SCHEMA).toMatch(fieldOf("PreWeighing", String.raw`quantity\s+Decimal\s+@db\.Decimal\(18, 6\)`));
    expect(SCHEMA).toMatch(
      fieldOf("PreWeighing", String.raw`createdById\s+String\s+@map\("created_by_id"\) @db\.Uuid`),
    );
  });

  it("snapshots the planned quantity next to the weighed one on every item", () => {
    expect(SCHEMA).toMatch(
      fieldOf(
        "PreWeighingItem",
        String.raw`plannedQuantity\s+Decimal\s+@map\("planned_quantity"\) @db\.Decimal\(18, 6\)`,
      ),
    );
    expect(SCHEMA).toMatch(
      fieldOf(
        "PreWeighingItem",
        String.raw`weighedQuantity\s+Decimal\s+@map\("weighed_quantity"\) @db\.Decimal\(18, 6\)`,
      ),
    );
  });

  it("lists a product at most once among the items of a pre-weighing", () => {
    expect(SCHEMA).toContain(
      `@@unique([preWeighingId, productSku], map: "uq_pre_weighing_items_pre_weighing_id_product_sku")`,
    );
  });

  it("indexes the pre-weighings of a product for cursor pagination", () => {
    expect(SCHEMA).toContain(
      `@@index([productSku, createdAt(sort: Desc), id(sort: Desc)], map: "idx_pre_weighings_product_sku_created_at")`,
    );
  });

  it("violates no rule of the table convention", () => {
    expect(findSchemaConventionViolations(SCHEMA)).toEqual([]);
  });
});
