import { Prisma, StockMovementType } from "../../generated/prisma/index.js";
import { prisma } from "../../lib/prisma.js";
import { takeFromLot } from "../stock/stock.repository.js";

const REASON_FIELDS = { select: { id: true, name: true, description: true, isActive: true } } as const;

export function listLossReasons() {
  return prisma.lossReason.findMany({ ...REASON_FIELDS, orderBy: { name: "asc" } });
}

export function findLossReasonById(id: string) {
  return prisma.lossReason.findUnique({ where: { id }, ...REASON_FIELDS });
}

export function findLossReasonByName(name: string) {
  return prisma.lossReason.findUnique({ where: { name }, ...REASON_FIELDS });
}

export function insertLossReason(input: { name: string; description?: string | null }) {
  return prisma.lossReason.create({ data: input, ...REASON_FIELDS });
}

export function updateLossReason(
  id: string,
  input: { name?: string; description?: string | null; isActive?: boolean },
) {
  return prisma.lossReason.update({ where: { id }, data: input, ...REASON_FIELDS });
}

// The lot, the balance, the movement and the loss change together or not at all. Answers the
// failure of the lot instead when it is missing or does not hold the quantity.
export function insertLoss(input: {
  lotId: string;
  reasonId: string;
  quantity: string;
  note?: string | null;
  createdById: string;
}) {
  const { lotId, reasonId, note, createdById } = input;
  const quantity = new Prisma.Decimal(input.quantity);

  return prisma.$transaction(async (tx) => {
    const taken = await takeFromLot(tx, { lotId, quantity });

    if ("failure" in taken) return taken;

    const { lot } = taken;
    const movement = await tx.stockMovement.create({
      data: {
        productSku: lot.productSku,
        lotId,
        quantity,
        unitCost: lot.unitCost,
        createdById,
        type: StockMovementType.LOSS,
      },
    });
    const loss = await tx.stockLoss.create({
      data: { lotId, reasonId, movementId: movement.id, note, createdById },
      select: {
        id: true,
        note: true,
        createdAt: true,
        reason: { select: { id: true, name: true } },
        lot: { select: { product: { select: { sku: true, description: true, unit: true } } } },
      },
    });

    return { loss, lot };
  });
}
