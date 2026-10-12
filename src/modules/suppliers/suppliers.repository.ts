import { prisma } from "../../lib/prisma.js";

const SUPPLIER_FIELDS = { select: { id: true, name: true } } as const;

export function listSuppliers() {
  return prisma.supplier.findMany({ ...SUPPLIER_FIELDS, orderBy: { name: "asc" } });
}

export function findSupplierById(id: string) {
  return prisma.supplier.findUnique({ where: { id }, ...SUPPLIER_FIELDS });
}

export function findSupplierByName(name: string) {
  return prisma.supplier.findUnique({ where: { name }, ...SUPPLIER_FIELDS });
}

export function insertSupplier(input: { name: string }) {
  return prisma.supplier.create({ data: input, ...SUPPLIER_FIELDS });
}
