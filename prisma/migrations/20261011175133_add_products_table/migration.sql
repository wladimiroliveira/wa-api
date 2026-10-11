-- CreateEnum
CREATE TYPE "product_kind" AS ENUM ('GOODS', 'MANUFACTURED');

-- CreateEnum
CREATE TYPE "measurement_unit" AS ENUM ('UNIT', 'KILOGRAM', 'GRAM', 'LITER', 'MILLILITER');

-- CreateTable
CREATE TABLE "products" (
    "sku" UUID NOT NULL,
    "gtin" TEXT,
    "name" TEXT NOT NULL,
    "kind" "product_kind" NOT NULL,
    "unit" "measurement_unit" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("sku")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_gtin_key" ON "products"("gtin");

-- CreateIndex
CREATE UNIQUE INDEX "products_name_key" ON "products"("name");
