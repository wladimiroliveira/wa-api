-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('ENTRY', 'PRODUCTION', 'WASTE');

-- CreateEnum
CREATE TYPE "WasteReason" AS ENUM ('SPOILED', 'DROPPED', 'EXPIRED', 'OTHER');

-- AlterTable
ALTER TABLE "Supply" ADD COLUMN     "currentStock" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantityBase" DECIMAL(65,30) NOT NULL,
    "reason" "WasteReason",
    "note" TEXT,
    "productionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Production" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "factor" DECIMAL(65,30) NOT NULL,
    "producedUnits" DECIMAL(65,30) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Production_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "Supply"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Production" ADD CONSTRAINT "Production_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
