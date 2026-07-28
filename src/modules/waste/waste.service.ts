import prisma from "../../lib/prisma.js";
import { Prisma, StockMovementType } from "../../generated/prisma/index.js";
import { getSupply } from "../supplies/supplies.repository.js";
import { assertItemDimension } from "../shared/dimension.js";
import { toBase } from "../shared/unit-of-measure.js";
import { applyMovement } from "../stock/stock.repository.js";
import { SupplyNotFoundError } from "../stock/stock.service.js";
import type { CreateWasteInput } from "./waste.schema.js";

export async function createWaste(supplyId: string, data: CreateWasteInput) {
  const supply = await getSupply(supplyId);
  if (!supply) throw new SupplyNotFoundError();
  assertItemDimension(supply.purchaseUnit, data.unit);

  const quantityBase = toBase(new Prisma.Decimal(data.quantity), data.unit).negated();

  const movement = await prisma.$transaction((tx) =>
    applyMovement(tx, {
      supplyId,
      type: StockMovementType.WASTE,
      quantityBase,
      reason: data.reason,
      note: data.note,
    }),
  );

  const updated = await getSupply(supplyId);
  return { movement, currentStock: updated?.currentStock };
}

export function listWastes() {
  return prisma.stockMovement.findMany({
    where: { type: StockMovementType.WASTE },
    include: { supply: true },
    orderBy: { createdAt: "desc" },
  });
}
