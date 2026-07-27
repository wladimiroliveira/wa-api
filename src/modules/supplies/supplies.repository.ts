import prisma from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/index.js";
import type { CreateSupplyInput, UpdateSupplyInput } from "./supplies.schema.js";

export function listSupplies() {
  return prisma.supply.findMany({ orderBy: { name: "asc" } });
}

export function getSupply(id: string) {
  return prisma.supply.findUnique({ where: { id } });
}

export function getSuppliesByIds(ids: string[]) {
  return prisma.supply.findMany({ where: { id: { in: ids } } });
}

export function createSupply(data: CreateSupplyInput) {
  return prisma.supply.create({
    data: {
      name: data.name,
      type: data.type,
      purchaseUnit: data.purchaseUnit,
      purchaseQty: new Prisma.Decimal(data.purchaseQty),
      purchasePrice: new Prisma.Decimal(data.purchasePrice),
    },
  });
}

export function updateSupply(id: string, data: UpdateSupplyInput) {
  return prisma.supply.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.type !== undefined && { type: data.type }),
      ...(data.purchaseUnit !== undefined && { purchaseUnit: data.purchaseUnit }),
      ...(data.purchaseQty !== undefined && { purchaseQty: new Prisma.Decimal(data.purchaseQty) }),
      ...(data.purchasePrice !== undefined && { purchasePrice: new Prisma.Decimal(data.purchasePrice) }),
    },
  });
}

export function deleteSupply(id: string) {
  return prisma.supply.delete({ where: { id } });
}
