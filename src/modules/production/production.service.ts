import prisma from "../../lib/prisma.js";
import { Prisma, StockMovementType } from "../../generated/prisma/index.js";
import { getRecipeWithItems } from "../recipes/recipes.repository.js";
import { applyMovement } from "../stock/stock.repository.js";
import { computeConsumption } from "./production.calc.js";
import type { CreateProductionInput } from "./production.schema.js";

export class RecipeNotFoundError extends Error {
  readonly code = "RECIPE_NOT_FOUND";
  constructor() {
    super("Receita não encontrada");
    this.name = "RecipeNotFoundError";
  }
}

export async function registerProduction(data: CreateProductionInput) {
  const recipe = await getRecipeWithItems(data.recipeId);
  if (!recipe) throw new RecipeNotFoundError();

  const spec = {
    batches: data.batches !== undefined ? new Prisma.Decimal(data.batches) : undefined,
    producedQty: data.producedQty !== undefined ? new Prisma.Decimal(data.producedQty) : undefined,
  };
  const { factor, producedUnits, consumptions } = computeConsumption(recipe, spec);

  const { production, warnings } = await prisma.$transaction(async (tx) => {
    const production = await tx.production.create({
      data: { recipeId: recipe.id, factor, producedUnits, note: data.note },
    });

    for (const c of consumptions) {
      await applyMovement(tx, {
        supplyId: c.supplyId,
        type: StockMovementType.PRODUCTION,
        quantityBase: c.consumedBase.negated(), // saída
        productionId: production.id,
      });
    }

    // Warnings: insumos cujo saldo resultante ficou negativo (regra "avisa, não bloqueia").
    const supplyIds = consumptions.map((c) => c.supplyId);
    const affected = await tx.supply.findMany({
      where: { id: { in: supplyIds } },
      select: { id: true, currentStock: true },
    });
    const warnings = affected
      .filter((s) => s.currentStock.lessThan(0))
      .map((s) => ({ supplyId: s.id, resultingStock: s.currentStock }));

    return { production, warnings };
  });

  return { production, consumptions, warnings };
}
