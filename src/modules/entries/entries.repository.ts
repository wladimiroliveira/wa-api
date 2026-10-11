import { StockMovementType } from "../../generated/prisma/index.js";
import { prisma } from "../../lib/prisma.js";
import { increaseStock } from "../stock/stock.repository.js";

export function findProductBySku(sku: string) {
  return prisma.product.findUnique({
    where: { sku },
    select: { sku: true, description: true, unit: true, isActive: true },
  });
}

// The movement and the balance change together or not at all.
export async function insertEntry(input: {
  productSku: string;
  quantity: string;
  unitCost: string;
  createdById: string;
}) {
  const [movement, [stock]] = await prisma.$transaction([
    prisma.stockMovement.create({ data: { ...input, type: StockMovementType.ENTRY } }),
    increaseStock(prisma, input),
  ]);

  return { movement, stock };
}
