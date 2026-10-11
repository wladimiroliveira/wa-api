import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findSchemaConventionViolations } from "../../scripts/schema-convention.js";

const SCHEMA = readFileSync(fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)), "utf8");

const fieldOf = (model: string, pattern: string) => new RegExp(`model ${model} \\{[^}]*?\\n\\s+${pattern}[^}]*?\\n\\}`);

describe("production schema", () => {
  it("declares the production, the item and the input tables", () => {
    expect(SCHEMA).toMatch(/model Production \{[\s\S]*?@@map\("productions"\)/);
    expect(SCHEMA).toMatch(/model ProductionItem \{[\s\S]*?@@map\("production_items"\)/);
    expect(SCHEMA).toMatch(/model ProductionItemInput \{[\s\S]*?@@map\("production_item_inputs"\)/);
  });

  it("starts a production in progress and records who started it and when it finished", () => {
    expect(SCHEMA).toMatch(
      /enum ProductionStatus \{\s+IN_PROGRESS\s+FINISHED\s+CANCELED\s+@@map\("production_status"\)/,
    );
    expect(SCHEMA).toMatch(fieldOf("Production", String.raw`status\s+ProductionStatus\s+@default\(IN_PROGRESS\)`));
    expect(SCHEMA).toMatch(fieldOf("Production", String.raw`createdById\s+String\s+@map\("created_by_id"\) @db\.Uuid`));
    expect(SCHEMA).toMatch(
      fieldOf("Production", String.raw`finishedAt\s+DateTime\?\s+@map\("finished_at"\) @db\.Timestamptz\(3\)`),
    );
  });

  it("records when a production was canceled", () => {
    expect(SCHEMA).toMatch(
      fieldOf("Production", String.raw`canceledAt\s+DateTime\?\s+@map\("canceled_at"\) @db\.Timestamptz\(3\)`),
    );
  });

  it("indexes the productions for cursor pagination", () => {
    expect(SCHEMA).toContain(`@@index([createdAt(sort: Desc), id(sort: Desc)], map: "idx_productions_created_at")`);
  });

  it("keeps the expected yield of an item next to the produced one, unknown until it finishes", () => {
    expect(SCHEMA).toMatch(
      fieldOf(
        "ProductionItem",
        String.raw`expectedQuantity\s+Decimal\s+@map\("expected_quantity"\) @db\.Decimal\(18, 6\)`,
      ),
    );
    expect(SCHEMA).toMatch(
      fieldOf(
        "ProductionItem",
        String.raw`producedQuantity\s+Decimal\?\s+@map\("produced_quantity"\) @db\.Decimal\(18, 6\)`,
      ),
    );
    expect(SCHEMA).toMatch(
      fieldOf("ProductionItem", String.raw`unitCost\s+Decimal\?\s+@map\("unit_cost"\) @db\.Decimal\(18, 6\)`),
    );
  });

  it("lets a pre-weighing guide a single production item", () => {
    expect(SCHEMA).toMatch(
      fieldOf("ProductionItem", String.raw`preWeighingId\s+String\?\s+@unique @map\("pre_weighing_id"\) @db\.Uuid`),
    );
  });

  it("snapshots the quantity of every input, and its cost once it leaves the stock", () => {
    expect(SCHEMA).toMatch(fieldOf("ProductionItemInput", String.raw`quantity\s+Decimal\s+@db\.Decimal\(18, 6\)`));
    expect(SCHEMA).toMatch(
      fieldOf("ProductionItemInput", String.raw`unitCost\s+Decimal\?\s+@map\("unit_cost"\) @db\.Decimal\(18, 6\)`),
    );
  });

  it("lists a product at most once among the inputs of an item", () => {
    expect(SCHEMA).toContain(
      `@@unique([productionItemId, productSku], map: "uq_production_item_inputs_production_item_id_product_sku")`,
    );
  });

  it("indexes the items of a production and the products they refer to", () => {
    expect(SCHEMA).toContain(`@@index([productionId], map: "idx_production_items_production_id")`);
    expect(SCHEMA).toContain(`@@index([productSku], map: "idx_production_items_product_sku")`);
    expect(SCHEMA).toContain(`@@index([productSku], map: "idx_production_item_inputs_product_sku")`);
  });

  it("violates no rule of the table convention", () => {
    expect(findSchemaConventionViolations(SCHEMA)).toEqual([]);
  });
});
