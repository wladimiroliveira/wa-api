import { MeasurementUnit, ProductKind } from "../../generated/prisma/index.js";
import { prisma } from "../../lib/prisma.js";

const PRODUCT_FIELDS = {
  select: { sku: true, gtin: true, description: true, kind: true, unit: true, isActive: true },
} as const;

export function listProducts() {
  return prisma.product.findMany({ ...PRODUCT_FIELDS, orderBy: { description: "asc" } });
}

export function findProductByDescription(description: string) {
  return prisma.product.findUnique({ where: { description }, ...PRODUCT_FIELDS });
}

export function findProductByGtin(gtin: string) {
  return prisma.product.findUnique({ where: { gtin }, ...PRODUCT_FIELDS });
}

export function insertProduct(input: { description: string; kind: ProductKind; unit: MeasurementUnit; gtin?: string }) {
  return prisma.product.create({ data: input, ...PRODUCT_FIELDS });
}
