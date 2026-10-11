import { Prisma } from "../../generated/prisma/index.js";
import { pageArgs } from "../../lib/pagination.js";
import { prisma } from "../../lib/prisma.js";

const productSelect = { sku: true, description: true, unit: true } satisfies Prisma.ProductSelect;

const preWeighingSelect = {
  id: true,
  quantity: true,
  createdAt: true,
  product: { select: productSelect },
  items: {
    select: { plannedQuantity: true, weighedQuantity: true, product: { select: productSelect } },
    orderBy: { product: { description: "asc" } },
  },
} satisfies Prisma.PreWeighingSelect;

export type PreWeighingRecord = Prisma.PreWeighingGetPayload<{ select: typeof preWeighingSelect }>;

export function findProductWithRecipe(sku: string) {
  return prisma.product.findUnique({
    where: { sku },
    select: {
      ...productSelect,
      isActive: true,
      recipe: {
        select: {
          yieldQuantity: true,
          ingredients: {
            select: { quantity: true, product: { select: { ...productSelect, isActive: true } } },
            orderBy: { product: { description: "asc" } },
          },
        },
      },
    },
  });
}

export function insertPreWeighing(input: {
  productSku: string;
  quantity: string;
  createdById: string;
  items: { productSku: string; plannedQuantity: Prisma.Decimal; weighedQuantity: string }[];
}) {
  const { items, ...preWeighing } = input;

  return prisma.preWeighing.create({
    data: { ...preWeighing, items: { create: items } },
    select: preWeighingSelect,
  });
}

export function findPreWeighingById(id: string) {
  return prisma.preWeighing.findUnique({ where: { id }, select: preWeighingSelect });
}

export function listPreWeighings(query: { available?: boolean; limit: number; cursor?: string }) {
  const { available, ...page } = query;
  const where: Prisma.PreWeighingWhereInput =
    available === undefined ? {} : { production: available ? null : { isNot: null } };

  return prisma.preWeighing.findMany({ where, select: preWeighingSelect, ...pageArgs(page) });
}
