-- CreateEnum
CREATE TYPE "stock_movement_type" AS ENUM ('ENTRY');

-- RenameColumn
ALTER TABLE "products" RENAME COLUMN "name" TO "description";

-- RenameIndex
ALTER INDEX "products_name_key" RENAME TO "products_description_key";

-- CreateTable
CREATE TABLE "product_stocks" (
    "product_sku" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "last_entry_cost" DECIMAL(18,6),
    "average_cost" DECIMAL(18,6),
    "minimum_quantity" DECIMAL(18,6),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_stocks_pkey" PRIMARY KEY ("product_sku")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "product_sku" UUID NOT NULL,
    "type" "stock_movement_type" NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_stock_movements_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "ck_stock_movements_unit_cost_non_negative" CHECK ("unit_cost" >= 0)
);

-- CreateIndex
CREATE INDEX "idx_stock_movements_product_sku_created_at" ON "stock_movements"("product_sku", "created_at" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "product_stocks" ADD CONSTRAINT "product_stocks_product_sku_fkey" FOREIGN KEY ("product_sku") REFERENCES "products"("sku") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_sku_fkey" FOREIGN KEY ("product_sku") REFERENCES "products"("sku") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
