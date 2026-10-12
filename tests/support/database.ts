import { PrismaClient } from "../../src/generated/prisma/index.js";

// vitest.config.ts points DATABASE_URL at the test schema for this project, so the tests and the
// application under test talk to the same database.
export const testPrisma = new PrismaClient();

// Truncating beats deleting row by row: it resets every table in one statement and does not depend
// on the order the foreign keys were declared in.
export async function resetDatabase(): Promise<void> {
  await testPrisma.$executeRawUnsafe(
    `TRUNCATE TABLE "production_item_inputs", "production_items", "productions", "pre_weighing_items", "pre_weighings", "recipe_ingredients", "recipes", "stock_movements", "stock_lots", "product_stocks", "products", "suppliers", "refresh_tokens", "users", "roles" RESTART IDENTITY CASCADE`,
  );
}
