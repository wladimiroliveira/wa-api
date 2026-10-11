import { MeasurementUnit, Prisma } from "../../generated/prisma/index.js";
import { planQuantity } from "./pre-weighings.plan.js";
import { findProductWithRecipe } from "./pre-weighings.repository.js";

type ProductSummary = { sku: string; description: string; unit: MeasurementUnit };

export type PreWeighingPlan = {
  product: ProductSummary;
  quantity: Prisma.Decimal;
  items: { product: ProductSummary; plannedQuantity: Prisma.Decimal }[];
};

type PlanResult = { plan: PreWeighingPlan } | { failure: { code: 404 | 409; message: string } };

const failure = (code: 404 | 409, message: string): PlanResult => ({ failure: { code, message } });

const summaryOf = ({ sku, description, unit }: ProductSummary): ProductSummary => ({ sku, description, unit });

// The one place that decides whether a product can be pre-weighed and how much of each ingredient
// that takes. The preview and the record both come through here, so what the operator was shown is
// what gets recorded as planned.
export async function planPreWeighing(productSku: string, quantity: string): Promise<PlanResult> {
  const product = await findProductWithRecipe(productSku);

  if (product === null) return failure(404, "Product not found.");
  if (!product.isActive) return failure(409, "Product is inactive.");
  if (product.recipe === null) return failure(409, "Product has no recipe.");

  const { yieldQuantity, ingredients } = product.recipe;

  if (ingredients.some((ingredient) => !ingredient.product.isActive)) {
    return failure(409, "The recipe takes an inactive product.");
  }

  const items: PreWeighingPlan["items"] = [];

  for (const ingredient of ingredients) {
    const plannedQuantity = planQuantity({ recipeQuantity: ingredient.quantity, yieldQuantity, quantity });

    if (plannedQuantity === null) return failure(409, "Quantity is out of range for this recipe.");

    items.push({ product: summaryOf(ingredient.product), plannedQuantity });
  }

  return { plan: { product: summaryOf(product), quantity: new Prisma.Decimal(quantity), items } };
}
