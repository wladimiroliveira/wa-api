-- AlterEnum
ALTER TYPE "stock_movement_type" ADD VALUE 'BALANCE_ADJUSTMENT';

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "lot_id" UUID;

-- CreateTable
CREATE TABLE "stock_lots" (
    "id" UUID NOT NULL,
    "product_sku" UUID NOT NULL,
    "supplier_id" UUID,
    "expires_at" TIMESTAMPTZ(3),
    "initial_quantity" DECIMAL(18,6) NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_lots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_stock_lots_product_sku_expires_at" ON "stock_lots"("product_sku", "expires_at", "created_at");

-- CreateIndex
CREATE INDEX "idx_stock_lots_supplier_id" ON "stock_lots"("supplier_id");

-- CreateIndex
CREATE INDEX "idx_stock_movements_lot_id" ON "stock_movements"("lot_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_product_sku_fkey" FOREIGN KEY ("product_sku") REFERENCES "products"("sku") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill
INSERT INTO "stock_lots" ("id", "product_sku", "initial_quantity", "quantity", "unit_cost", "updated_at")
SELECT gen_random_uuid(), "product_sku", "quantity", "quantity", COALESCE("average_cost", 0), CURRENT_TIMESTAMP
FROM "product_stocks" AS "stock"
WHERE "stock"."quantity" > 0
  AND NOT EXISTS (SELECT 1 FROM "stock_lots" AS "lot" WHERE "lot"."product_sku" = "stock"."product_sku");
