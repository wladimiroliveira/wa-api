import { prisma } from "../../lib/prisma.js";

export function listProducts() {
  return prisma.product.findMany({
    select: { sku: true, gtin: true, description: true, kind: true, unit: true, isActive: true },
    orderBy: { description: "asc" },
  });
}
