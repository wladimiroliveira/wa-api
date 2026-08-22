import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findSchemaConventionViolations } from "../../scripts/schema-convention.js";

const COMPLIANT_MODEL = `
model StockMovement {
  id           String   @id @default(uuid(7)) @db.Uuid
  supplyId     String   @map("supply_id") @db.Uuid
  quantityBase Decimal  @map("quantity_base") @db.Decimal(18, 6)
  isReversal   Boolean  @default(false) @map("is_reversal")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  @@unique([supplyId, quantityBase], map: "uq_stock_movements_supply_id_quantity_base")
  @@index([supplyId, createdAt(sort: Desc), id(sort: Desc)], map: "idx_stock_movements_supply_id_created_at")
  @@map("stock_movements")
}
`;

const rulesFor = (source: string) => findSchemaConventionViolations(source).map((violation) => violation.rule);

describe("findSchemaConventionViolations", () => {
  it("accepts a model that follows every rule", () => {
    expect(findSchemaConventionViolations(COMPLIANT_MODEL)).toEqual([]);
  });

  it("rejects a model without @@map", () => {
    expect(rulesFor(COMPLIANT_MODEL.replace(`  @@map("stock_movements")\n`, ""))).toContain("table-map");
  });

  it("rejects a table name that is not plural", () => {
    expect(rulesFor(COMPLIANT_MODEL.replace(`"stock_movements"`, `"stock_movement"`))).toContain("table-plural");
  });

  it("rejects a camelCase column that has no @map", () => {
    expect(rulesFor(COMPLIANT_MODEL.replace(`@map("supply_id") `, ""))).toContain("column-snake-case");
  });

  it("rejects an identifier column without @db.Uuid, which would become TEXT", () => {
    expect(rulesFor(COMPLIANT_MODEL.replace(`@default(uuid(7)) @db.Uuid`, `@default(uuid(7))`))).toContain(
      "uuid-native-type",
    );
  });

  it("rejects a Decimal without explicit precision, which would become numeric(65,30)", () => {
    expect(rulesFor(COMPLIANT_MODEL.replace(` @db.Decimal(18, 6)`, ""))).toContain("decimal-precision");
  });

  it("rejects a DateTime that is not timestamptz", () => {
    expect(rulesFor(COMPLIANT_MODEL.replace(` @db.Timestamptz(3)`, ""))).toContain("timestamptz");
  });

  it("rejects a DateTime field that does not end with At", () => {
    expect(rulesFor(COMPLIANT_MODEL.replace("createdAt    DateTime", "creation     DateTime"))).toContain(
      "datetime-suffix",
    );
  });

  it("rejects a Boolean field that starts with neither is nor has", () => {
    expect(rulesFor(COMPLIANT_MODEL.replace("isReversal   Boolean", "reversal     Boolean"))).toContain(
      "boolean-prefix",
    );
  });

  it("rejects an @@index without an explicit map, whose generated name can be truncated", () => {
    expect(rulesFor(COMPLIANT_MODEL.replace(`, map: "idx_stock_movements_supply_id_created_at"`, ""))).toContain(
      "index-map",
    );
  });

  it("rejects a snake_case identifier field that would silently become TEXT", () => {
    const source = `
model Order {
  id        String @id @db.Uuid
  supply_id String
  @@map("orders")
}
`;
    expect(rulesFor(source)).toContain("uuid-native-type");
  });

  it("rejects a composite unique without an explicit map", () => {
    expect(rulesFor(COMPLIANT_MODEL.replace(`, map: "uq_stock_movements_supply_id_quantity_base"`, ""))).toContain(
      "unique-map",
    );
  });

  it("rejects a unique constraint name that does not start with uq_", () => {
    expect(
      rulesFor(COMPLIANT_MODEL.replace(`"uq_stock_movements_supply_id_quantity_base"`, `"idx_wrong_prefix"`)),
    ).toContain("unique-prefix");
  });

  it("rejects an indented model, whose rules would otherwise be skipped", () => {
    const source = `
  model Order {
    id        String   @id @default(uuid(7))
    total     Decimal  @map("total")
    createdAt DateTime @map("created_at")

    @@map("orders")
  }
`;
    expect(rulesFor(source)).toEqual(expect.arrayContaining(["uuid-native-type", "decimal-precision", "timestamptz"]));
  });

  it("rejects a multi-line @@index without an explicit map", () => {
    const source = `
model Order {
  id        String   @id @default(uuid(7)) @db.Uuid
  supplyId  String   @map("supply_id") @db.Uuid
  createdAt DateTime @map("created_at") @db.Timestamptz(3)

  @@index([
    supplyId,
    createdAt
  ])
  @@map("orders")
}
`;
    expect(rulesFor(source)).toContain("index-map");
  });

  it("rejects a model whose only @@map is commented out", () => {
    const source = COMPLIANT_MODEL.replace(`  @@map("stock_movements")`, `  // @@map("stock_movements")`);
    expect(rulesFor(source)).toContain("table-map");
  });

  it("accepts a commented-out @@index, which creates no index", () => {
    const source = `
model Order {
  id String @id @default(uuid(7)) @db.Uuid

  // @@index([id])
  @@map("orders")
}
`;
    expect(rulesFor(source)).toEqual([]);
  });

  it("accepts an @@map with spaces inside the parentheses", () => {
    const source = COMPLIANT_MODEL.replace(`@@map("stock_movements")`, `@@map( "stock_movements" )`);
    expect(rulesFor(source)).toEqual([]);
  });

  it("keeps the project schema free of violations", () => {
    expect(findSchemaConventionViolations(readFileSync("prisma/schema.prisma", "utf8"))).toEqual([]);
  });
});
