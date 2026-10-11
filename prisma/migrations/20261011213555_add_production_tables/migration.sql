-- CreateEnum
CREATE TYPE "production_status" AS ENUM ('IN_PROGRESS', 'FINISHED', 'CANCELED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "stock_movement_type" ADD VALUE 'PRODUCTION_CONSUMPTION';
ALTER TYPE "stock_movement_type" ADD VALUE 'PRODUCTION_OUTPUT';

-- CreateTable
CREATE TABLE "productions" (
    "id" UUID NOT NULL,
    "status" "production_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),

    CONSTRAINT "productions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_productions_finished_at_matches_status" CHECK (("status" = 'FINISHED') = ("finished_at" IS NOT NULL)),
    CONSTRAINT "ck_productions_canceled_at_matches_status" CHECK (("status" = 'CANCELED') = ("canceled_at" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "production_items" (
    "id" UUID NOT NULL,
    "production_id" UUID NOT NULL,
    "product_sku" UUID NOT NULL,
    "pre_weighing_id" UUID,
    "expected_quantity" DECIMAL(18,6) NOT NULL,
    "produced_quantity" DECIMAL(18,6),
    "unit_cost" DECIMAL(18,6),

    CONSTRAINT "production_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_production_items_expected_quantity_positive" CHECK ("expected_quantity" > 0),
    CONSTRAINT "ck_production_items_produced_quantity_positive" CHECK ("produced_quantity" > 0),
    CONSTRAINT "ck_production_items_unit_cost_non_negative" CHECK ("unit_cost" >= 0)
);

-- CreateTable
CREATE TABLE "production_item_inputs" (
    "id" UUID NOT NULL,
    "production_item_id" UUID NOT NULL,
    "product_sku" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(18,6),

    CONSTRAINT "production_item_inputs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_production_item_inputs_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "ck_production_item_inputs_unit_cost_non_negative" CHECK ("unit_cost" >= 0)
);

-- CreateIndex
CREATE INDEX "idx_productions_created_at" ON "productions"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "production_items_pre_weighing_id_key" ON "production_items"("pre_weighing_id");

-- CreateIndex
CREATE INDEX "idx_production_items_production_id" ON "production_items"("production_id");

-- CreateIndex
CREATE INDEX "idx_production_items_product_sku" ON "production_items"("product_sku");

-- CreateIndex
CREATE INDEX "idx_production_item_inputs_product_sku" ON "production_item_inputs"("product_sku");

-- CreateIndex
CREATE UNIQUE INDEX "uq_production_item_inputs_production_item_id_product_sku" ON "production_item_inputs"("production_item_id", "product_sku");

-- CreateIndex
CREATE INDEX "idx_pre_weighings_created_at" ON "pre_weighings"("created_at" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "productions" ADD CONSTRAINT "productions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_production_id_fkey" FOREIGN KEY ("production_id") REFERENCES "productions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_product_sku_fkey" FOREIGN KEY ("product_sku") REFERENCES "products"("sku") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_pre_weighing_id_fkey" FOREIGN KEY ("pre_weighing_id") REFERENCES "pre_weighings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_item_inputs" ADD CONSTRAINT "production_item_inputs_production_item_id_fkey" FOREIGN KEY ("production_item_id") REFERENCES "production_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_item_inputs" ADD CONSTRAINT "production_item_inputs_product_sku_fkey" FOREIGN KEY ("product_sku") REFERENCES "products"("sku") ON DELETE RESTRICT ON UPDATE CASCADE;
