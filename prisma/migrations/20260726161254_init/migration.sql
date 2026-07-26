-- CreateEnum
CREATE TYPE "SupplyType" AS ENUM ('INGREDIENT', 'PACKAGING');

-- CreateEnum
CREATE TYPE "UnitOfMeasure" AS ENUM ('G', 'KG', 'ML', 'L', 'UN');

-- CreateTable
CREATE TABLE "Supply" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SupplyType" NOT NULL,
    "purchaseUnit" "UnitOfMeasure" NOT NULL,
    "purchaseQty" DECIMAL(65,30) NOT NULL,
    "purchasePrice" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "batchYield" DECIMAL(65,30) NOT NULL,
    "laborCostPerHundred" DECIMAL(65,30) NOT NULL,
    "margin" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeItem" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "usageQty" DECIMAL(65,30) NOT NULL,
    "usageUnit" "UnitOfMeasure" NOT NULL,

    CONSTRAINT "RecipeItem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "Supply"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
