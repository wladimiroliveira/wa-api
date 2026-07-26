import prisma from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/index.js";
import type { CreateRecipeInput } from "./recipes.schema.js";

export function listRecipes() {
  return prisma.recipe.findMany({ orderBy: { name: "asc" } });
}

// Usado pelo módulo pricing: inclui itens e o supply de cada item.
export function getRecipeWithItems(id: string) {
  return prisma.recipe.findUnique({
    where: { id },
    include: { items: { include: { supply: true } } },
  });
}

export function createRecipe(data: CreateRecipeInput) {
  return prisma.recipe.create({
    data: {
      name: data.name,
      batchYield: new Prisma.Decimal(data.batchYield),
      laborCostPerHundred: new Prisma.Decimal(data.laborCostPerHundred),
      margin: new Prisma.Decimal(data.margin),
      items: {
        create: data.items.map((item) => ({
          supplyId: item.supplyId,
          usageQty: new Prisma.Decimal(item.usageQty),
          usageUnit: item.usageUnit,
        })),
      },
    },
    include: { items: true },
  });
}

export function updateMargin(id: string, margin: number) {
  return prisma.recipe.update({
    where: { id },
    data: { margin: new Prisma.Decimal(margin) },
  });
}

export function deleteRecipe(id: string) {
  return prisma.recipe.delete({ where: { id } });
}
