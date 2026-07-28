import prisma from "../../lib/prisma.js";
import { Prisma, StockMovementType, WasteReason } from "../../generated/prisma/index.js";

export interface ApplyMovementInput {
  supplyId: string;
  type: StockMovementType;
  quantityBase: Prisma.Decimal; // com sinal: + entrada, - saída
  reason?: WasteReason;
  note?: string;
  productionId?: string;
}

// Cria a movimentação e mantém o saldo na MESMA transação (fonte de verdade única).
export async function applyMovement(tx: Prisma.TransactionClient, input: ApplyMovementInput) {
  const movement = await tx.stockMovement.create({
    data: {
      supplyId: input.supplyId,
      type: input.type,
      quantityBase: input.quantityBase,
      reason: input.reason,
      note: input.note,
      productionId: input.productionId,
    },
  });
  await tx.supply.update({
    where: { id: input.supplyId },
    data: { currentStock: { increment: input.quantityBase } },
  });
  return movement;
}

export function listMovements(supplyId: string) {
  return prisma.stockMovement.findMany({
    where: { supplyId },
    orderBy: { createdAt: "desc" },
  });
}
