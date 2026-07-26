import { Prisma, UnitOfMeasure } from "../../generated/prisma/index.js";
import { toBase } from "../shared/unit-of-measure.js";
import { costPerBase, type SupplyCostInput } from "../supplies/supplies.cost.js";
import { ONE_REAL, roundUpToNearest } from "../shared/money.js";

export interface RecipeItemForPricing {
  usageQty: Prisma.Decimal;
  usageUnit: UnitOfMeasure;
  supply: SupplyCostInput;
}

export interface RecipeForPricing {
  batchYield: Prisma.Decimal;
  laborCostPerHundred: Prisma.Decimal;
  margin: Prisma.Decimal;
  items: RecipeItemForPricing[];
}

export interface PricingResult {
  suppliesCostPerHundred: Prisma.Decimal;
  totalCostPerHundred: Prisma.Decimal;
  exactPrice: Prisma.Decimal;
  pricePerHundred: Prisma.Decimal;
  pricePerHalfHundred: Prisma.Decimal;
}

export function calculatePricing(recipe: RecipeForPricing): PricingResult {
  const suppliesCostPerBatch = recipe.items.reduce(
    (acc, item) => acc.add(toBase(item.usageQty, item.usageUnit).mul(costPerBase(item.supply))),
    new Prisma.Decimal(0),
  );

  const hundreds = recipe.batchYield.div(100);
  const suppliesCostPerHundred = suppliesCostPerBatch.div(hundreds);
  const totalCostPerHundred = suppliesCostPerHundred.add(recipe.laborCostPerHundred);

  const exactPrice = totalCostPerHundred.mul(ONE_REAL.add(recipe.margin));
  const pricePerHundred = roundUpToNearest(exactPrice, ONE_REAL);
  const pricePerHalfHundred = roundUpToNearest(pricePerHundred.div(2), ONE_REAL);

  return {
    suppliesCostPerHundred,
    totalCostPerHundred,
    exactPrice,
    pricePerHundred,
    pricePerHalfHundred,
  };
}
