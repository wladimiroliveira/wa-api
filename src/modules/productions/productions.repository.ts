import { Prisma, ProductionStatus, StockMovementType } from "../../generated/prisma/index.js";
import { pageArgs } from "../../lib/pagination.js";
import { prisma } from "../../lib/prisma.js";
import { decreaseStock, increaseStock } from "../stock/stock.repository.js";

const productSelect = { sku: true, description: true, unit: true } satisfies Prisma.ProductSelect;

const productionSelect = {
  id: true,
  status: true,
  createdAt: true,
  finishedAt: true,
  canceledAt: true,
  items: {
    select: {
      id: true,
      preWeighingId: true,
      expectedQuantity: true,
      producedQuantity: true,
      unitCost: true,
      product: { select: productSelect },
      inputs: {
        select: { id: true, quantity: true, unitCost: true, product: { select: productSelect } },
        orderBy: { product: { description: "asc" } },
      },
    },
    orderBy: [{ product: { description: "asc" } }, { id: "asc" }],
  },
} satisfies Prisma.ProductionSelect;

export type ProductionRecord = Prisma.ProductionGetPayload<{ select: typeof productionSelect }>;

export type PlannedProductionItem = {
  productSku: string;
  preWeighingId: string | null;
  expectedQuantity: Prisma.Decimal;
  inputs: { productSku: string; quantity: Prisma.Decimal }[];
};

export function insertProduction(input: { createdById: string; items: PlannedProductionItem[] }) {
  return prisma.production.create({
    data: {
      createdById: input.createdById,
      items: { create: input.items.map(({ inputs, ...item }) => ({ ...item, inputs: { create: inputs } })) },
    },
    select: productionSelect,
  });
}

export function findProductionById(id: string) {
  return prisma.production.findUnique({ where: { id }, select: productionSelect });
}

export function listProductions(query: { status?: ProductionStatus; limit: number; cursor?: string }) {
  const { status, ...page } = query;

  return prisma.production.findMany({ where: { status }, select: productionSelect, ...pageArgs(page) });
}

// Whatever a production moves in the stock happens in one transaction: it finishes whole or not
// at all, and so does whatever else changes along with its status.
export function inProductionTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(work);
}

// False when the production is no longer in progress. The conditional update is what keeps two
// simultaneous requests from finishing the same production twice, or one from finishing what
// another is canceling.
async function leaveInProgress(
  tx: Prisma.TransactionClient,
  id: string,
  data: { status: ProductionStatus; finishedAt?: Date; canceledAt?: Date },
) {
  const { count } = await tx.production.updateMany({ where: { id, status: ProductionStatus.IN_PROGRESS }, data });

  return count === 1;
}

export const markProductionFinished = (tx: Prisma.TransactionClient, id: string) =>
  leaveInProgress(tx, id, { status: ProductionStatus.FINISHED, finishedAt: new Date() });

export const markProductionCanceled = (tx: Prisma.TransactionClient, id: string) =>
  leaveInProgress(tx, id, { status: ProductionStatus.CANCELED, canceledAt: new Date() });

// A pre-weighing guides a single item, so the items of a production that will not happen let go
// of theirs: what was weighed is still on the bench, waiting for another production.
export function releasePreWeighings(tx: Prisma.TransactionClient, productionId: string) {
  return tx.productionItem.updateMany({ where: { productionId }, data: { preWeighingId: null } });
}

// Takes an input from the stock and answers what each unit of it was worth. One that never
// entered the stock has no cost to count.
export async function consumeProductionInput(
  tx: Prisma.TransactionClient,
  input: { id: string; productSku: string; quantity: Prisma.Decimal; createdById: string },
) {
  const { id, ...movement } = input;
  const [stock] = await decreaseStock(tx, { productSku: input.productSku, quantity: input.quantity.toString() });
  const unitCost = stock.averageCost ?? new Prisma.Decimal(0);

  await tx.stockMovement.create({ data: { ...movement, unitCost, type: StockMovementType.PRODUCTION_CONSUMPTION } });
  await tx.productionItemInput.update({ where: { id }, data: { unitCost } });

  return unitCost;
}

export async function outputProductionItem(
  tx: Prisma.TransactionClient,
  item: { id: string; productSku: string; quantity: string; unitCost: Prisma.Decimal; createdById: string },
) {
  const { id, ...movement } = item;

  await tx.stockMovement.create({ data: { ...movement, type: StockMovementType.PRODUCTION_OUTPUT } });
  await increaseStock(tx, { ...movement, unitCost: item.unitCost.toString() });
  await tx.productionItem.update({
    where: { id },
    data: { producedQuantity: item.quantity, unitCost: item.unitCost },
  });
}
