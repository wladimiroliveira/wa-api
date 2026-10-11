-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "product_sku" UUID NOT NULL,
    "yield_quantity" DECIMAL(18,6) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_recipes_yield_quantity_positive" CHECK ("yield_quantity" > 0)
);

-- CreateTable
CREATE TABLE "recipe_ingredients" (
    "id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "product_sku" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_recipe_ingredients_quantity_positive" CHECK ("quantity" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "recipes_product_sku_key" ON "recipes"("product_sku");

-- CreateIndex
CREATE INDEX "idx_recipe_ingredients_product_sku" ON "recipe_ingredients"("product_sku");

-- CreateIndex
CREATE UNIQUE INDEX "uq_recipe_ingredients_recipe_id_product_sku" ON "recipe_ingredients"("recipe_id", "product_sku");

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_product_sku_fkey" FOREIGN KEY ("product_sku") REFERENCES "products"("sku") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_product_sku_fkey" FOREIGN KEY ("product_sku") REFERENCES "products"("sku") ON DELETE RESTRICT ON UPDATE CASCADE;
