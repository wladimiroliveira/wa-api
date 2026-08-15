import prisma from "../../lib/prisma.js";
import { Prisma, StockMovementType } from "../../generated/prisma/index.js";
import { getSupply } from "../supplies/supplies.repository.js";
import { assertItemDimension } from "../shared/dimension.js";
import { toBase } from "../shared/unit-of-measure.js";
import { applyMovement } from "./stock.repository.js";
import type { CreateStockEntryInput } from "./stock.schema.js";

export class SupplyNotFoundError extends Error {
  readonly code = "SUPPLY_NOT_FOUND";
  constructor() {
    super("Insumo não encontrado");
    this.name = "SupplyNotFoundError";
  }
}

export async function createStockEntry(supplyId: string, data: CreateStockEntryInput) {
  const supply = await getSupply(supplyId);
  if (!supply) throw new SupplyNotFoundError();
  assertItemDimension(supply.purchaseUnit, data.unit);

  const quantityBase = toBase(new Prisma.Decimal(data.quantity), data.unit);

  const movement = await prisma.$transaction((tx) =>
    applyMovement(tx, {
      supplyId,
      type: StockMovementType.ENTRY,
      quantityBase,
      note: data.note,
    }),
  );

  // O insumo foi validado no início; o saldo sempre existe aqui.
  const updated = await getSupply(supplyId);
  return { movement, currentStock: updated!.currentStock };
}
