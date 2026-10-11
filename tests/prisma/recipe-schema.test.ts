import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findSchemaConventionViolations } from "../../scripts/schema-convention.js";

const SCHEMA = readFileSync(fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)), "utf8");

const fieldOf = (model: string, pattern: string) => new RegExp(`model ${model} \\{[^}]*?\\n\\s+${pattern}[^}]*?\\n\\}`);

describe("recipe schema", () => {
  it("declares the recipe and the ingredient tables", () => {
    expect(SCHEMA).toMatch(/model Recipe \{[\s\S]*?@@map\("recipes"\)/);
    expect(SCHEMA).toMatch(/model RecipeIngredient \{[\s\S]*?@@map\("recipe_ingredients"\)/);
  });

  it("gives a product a single recipe", () => {
    expect(SCHEMA).toMatch(
      fieldOf("Recipe", String.raw`productSku\s+String\s+@unique @map\("product_sku"\) @db\.Uuid`),
    );
  });

  it("states how much of the product the listed ingredients yield", () => {
    expect(SCHEMA).toMatch(
      fieldOf("Recipe", String.raw`yieldQuantity\s+Decimal\s+@map\("yield_quantity"\) @db\.Decimal\(18, 6\)`),
    );
  });

  it("lists a product at most once among the ingredients of a recipe", () => {
    expect(SCHEMA).toMatch(fieldOf("RecipeIngredient", String.raw`quantity\s+Decimal\s+@db\.Decimal\(18, 6\)`));
    expect(SCHEMA).toContain(`@@unique([recipeId, productSku], map: "uq_recipe_ingredients_recipe_id_product_sku")`);
  });

  it("indexes the ingredients by product, to find the recipes a product is used in", () => {
    expect(SCHEMA).toContain(`@@index([productSku], map: "idx_recipe_ingredients_product_sku")`);
  });

  it("violates no rule of the table convention", () => {
    expect(findSchemaConventionViolations(SCHEMA)).toEqual([]);
  });
});
