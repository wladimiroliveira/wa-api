-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "permission" ADD VALUE 'LOSSES_CREATE';
ALTER TYPE "permission" ADD VALUE 'LOSSES_UPDATE';

-- AlterEnum
ALTER TYPE "stock_movement_type" ADD VALUE 'LOSS';

-- CreateTable
CREATE TABLE "loss_reasons" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "loss_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_losses" (
    "id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "reason_id" UUID NOT NULL,
    "movement_id" UUID NOT NULL,
    "note" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_losses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loss_reasons_name_key" ON "loss_reasons"("name");

-- CreateIndex
CREATE UNIQUE INDEX "stock_losses_movement_id_key" ON "stock_losses"("movement_id");

-- CreateIndex
CREATE INDEX "idx_stock_losses_lot_id" ON "stock_losses"("lot_id");

-- CreateIndex
CREATE INDEX "idx_stock_losses_reason_id" ON "stock_losses"("reason_id");

-- CreateIndex
CREATE INDEX "idx_stock_losses_created_by_id" ON "stock_losses"("created_by_id");

-- AddForeignKey
ALTER TABLE "stock_losses" ADD CONSTRAINT "stock_losses_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_losses" ADD CONSTRAINT "stock_losses_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "loss_reasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_losses" ADD CONSTRAINT "stock_losses_movement_id_fkey" FOREIGN KEY ("movement_id") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_losses" ADD CONSTRAINT "stock_losses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
