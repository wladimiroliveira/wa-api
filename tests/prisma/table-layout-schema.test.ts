import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findSchemaConventionViolations } from "../../scripts/schema-convention.js";

const SCHEMA = readFileSync(fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)), "utf8");

const fieldOf = (model: string, pattern: string) => new RegExp(`model ${model} \\{[^}]*?\\n\\s+${pattern}[^}]*?\\n\\}`);

describe("table layout schema", () => {
  it("declares the table layouts table", () => {
    expect(SCHEMA).toMatch(/model TableLayout \{[\s\S]*?@@map\("table_layouts"\)/);
  });

  it("keeps one layout per user and table", () => {
    expect(SCHEMA).toMatch(
      /model TableLayout \{[\s\S]*?@@unique\(\[userId, tableKey\], map: "uq_table_layouts_user_id_table_key"\)/,
    );
  });

  it("goes away with its user", () => {
    expect(SCHEMA).toMatch(
      fieldOf(
        "TableLayout",
        String.raw`user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)`,
      ),
    );
  });

  it("violates no rule of the table convention", () => {
    expect(findSchemaConventionViolations(SCHEMA)).toEqual([]);
  });
});
