import { Prisma, StockMovementType } from "../../generated/prisma/index.js";
import { prisma } from "../../lib/prisma.js";
import { increaseStock, lockStockBalance, zeroStockBalance } from "../stock/stock.repository.js";
import { DeficitSettlement } from "./entries.schemas.js";

export function findProductBySku(sku: string) {
  return prisma.product.findUnique({
    where: { sku },
    select: { sku: true, description: true, unit: true, isActive: true },
  });
}

// Thrown inside the transaction, so nothing of the entry is written, and turned into an answer
// outside of it.
export class NegativeBalancePendingError extends Error {
  constructor(readonly deficit: Prisma.Decimal) {
    super("The product has a negative balance to settle.");
  }
}

const ZERO = new Prisma.Decimal(0);

// The lot, the movement and the balance change together or not at all. The balance is locked
// first: what the entry does depends on whether it is negative, and that must not change under it.
export function insertEntry(input: {
  productSku: string;
  quantity: string;
  unitCost: string;
  expiresAt: string | null;
  supplierId?: string;
  deficit?: DeficitSettlement;
  createdById: string;
}) {
  const { productSku, quantity, unitCost, createdById } = input;

  return prisma.$transaction(async (tx) => {
    const balance = await lockStockBalance(tx, productSku);
    const owed = balance !== null && balance.quantity.lt(0) ? balance.quantity.neg() : ZERO;

    if (owed.gt(0) && input.deficit === undefined) throw new NegativeBalancePendingError(owed);

    if (owed.gt(0) && input.deficit === DeficitSettlement.ZERO) {
      await zeroStockBalance(tx, productSku);
      await tx.stockMovement.create({
        data: {
          productSku,
          createdById,
          type: StockMovementType.BALANCE_ADJUSTMENT,
          quantity: owed,
          unitCost: balance?.lastEntryCost ?? ZERO,
        },
      });
    }

    const [stock] = await increaseStock(tx, { productSku, quantity, unitCost });

    // Still owed at this point means the entry pays for it: the lot keeps only what is left.
    const left =
      input.deficit === DeficitSettlement.DISCOUNT ? Prisma.Decimal.max(ZERO, owed.neg().add(quantity)) : quantity;

    const lot = await tx.stockLot.create({
      data: {
        productSku,
        supplierId: input.supplierId,
        expiresAt: input.expiresAt === null ? null : new Date(input.expiresAt),
        initialQuantity: quantity,
        quantity: left,
        unitCost,
      },
      select: { id: true, expiresAt: true, quantity: true, supplier: { select: { id: true, name: true } } },
    });

    const movement = await tx.stockMovement.create({
      data: { productSku, quantity, unitCost, createdById, lotId: lot.id, type: StockMovementType.ENTRY },
    });

    return { movement, lot, stock };
  });
}
