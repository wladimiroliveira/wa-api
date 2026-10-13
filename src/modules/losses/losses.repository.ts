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

type ReasonFailure = "reason-missing" | "reason-inactive";

// Thrown inside the transaction of a loss so that what it had already taken from the lot is undone.
class RefusedReason extends Error {
  constructor(readonly failure: ReasonFailure) {
    super(failure);
  }
}

// The reason is read once the stock is held and kept as it is until the loss is recorded: read any
// earlier, it could be put out of use while the loss waits its turn at the stock.
async function holdReasonInUse(client: Prisma.TransactionClient, reasonId: string) {
  const [reason] = await client.$queryRaw<{ isActive: boolean }[]>`
    SELECT is_active AS "isActive" FROM loss_reasons WHERE id = ${reasonId}::uuid FOR SHARE
  `;

  if (reason === undefined) throw new RefusedReason("reason-missing");
  if (!reason.isActive) throw new RefusedReason("reason-inactive");
}

// The lot, the balance, the movement and the loss change together or not at all. Answers the
// failure instead when the lot is missing or does not hold the quantity, or the reason is missing
// or no longer in use.
export async function insertLoss(input: {
  lotId: string;
  reasonId: string;
  quantity: string;
  note?: string | null;
  createdById: string;
}) {
  const { lotId, reasonId, note, createdById } = input;
  const quantity = new Prisma.Decimal(input.quantity);

  try {
    return await prisma.$transaction(async (tx) => {
      const taken = await takeFromLot(tx, { lotId, quantity });

      if ("failure" in taken) return taken;

      await holdReasonInUse(tx, reasonId);

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
          movement: { select: { quantity: true } },
          lot: { select: { product: { select: { sku: true, description: true, unit: true } } } },
        },
      });

      return { loss, lot };
    });
  } catch (error) {
    if (error instanceof RefusedReason) return { failure: error.failure };

    throw error;
  }
}
