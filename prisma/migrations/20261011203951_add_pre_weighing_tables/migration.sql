-- CreateTable
CREATE TABLE "pre_weighings" (
    "id" UUID NOT NULL,
    "product_sku" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pre_weighings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_pre_weighings_quantity_positive" CHECK ("quantity" > 0)
);

-- CreateTable
CREATE TABLE "pre_weighing_items" (
    "id" UUID NOT NULL,
    "pre_weighing_id" UUID NOT NULL,
    "product_sku" UUID NOT NULL,
    "planned_quantity" DECIMAL(18,6) NOT NULL,
    "weighed_quantity" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "pre_weighing_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_pre_weighing_items_planned_quantity_positive" CHECK ("planned_quantity" > 0),
    CONSTRAINT "ck_pre_weighing_items_weighed_quantity_positive" CHECK ("weighed_quantity" > 0)
);

-- CreateIndex
CREATE INDEX "idx_pre_weighings_product_sku_created_at" ON "pre_weighings"("product_sku", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "idx_pre_weighing_items_product_sku" ON "pre_weighing_items"("product_sku");

-- CreateIndex
CREATE UNIQUE INDEX "uq_pre_weighing_items_pre_weighing_id_product_sku" ON "pre_weighing_items"("pre_weighing_id", "product_sku");

-- AddForeignKey
ALTER TABLE "pre_weighings" ADD CONSTRAINT "pre_weighings_product_sku_fkey" FOREIGN KEY ("product_sku") REFERENCES "products"("sku") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_weighings" ADD CONSTRAINT "pre_weighings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_weighing_items" ADD CONSTRAINT "pre_weighing_items_pre_weighing_id_fkey" FOREIGN KEY ("pre_weighing_id") REFERENCES "pre_weighings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_weighing_items" ADD CONSTRAINT "pre_weighing_items_product_sku_fkey" FOREIGN KEY ("product_sku") REFERENCES "products"("sku") ON DELETE RESTRICT ON UPDATE CASCADE;
