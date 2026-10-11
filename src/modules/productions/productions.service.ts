import { Prisma, ProductionStatus } from "../../generated/prisma/index.js";
import { toStoredDecimal } from "../../lib/decimal.js";
import { findPreWeighingById } from "../pre-weighings/pre-weighings.repository.js";
import { planPreWeighing } from "../pre-weighings/pre-weighings.service.js";
import {
  consumeProductionInput,
  findProductionById,
  inProductionTransaction,
  insertProduction,
  markProductionCanceled,
  markProductionFinished,
  outputProductionItem,
  PlannedProductionItem,
  ProductionRecord,
  releasePreWeighings,
} from "./productions.repository.js";
import { ProductionItemRequest } from "./productions.schemas.js";

type Failure = { failure: { code: 404 | 409; message: string } };
type ProductionResult = { production: ProductionRecord } | Failure;

const failure = (code: 404 | 409, message: string): Failure => ({ failure: { code, message } });

const notFound = failure(404, "Production not found.");
const notInProgress = failure(409, "Production is not in progress.");

// Thrown inside the transaction to undo what it already moved, and turned back into an answer
// outside of it.
class ProductionAborted extends Error {
  constructor(readonly result: Failure) {
    super(result.failure.message);
  }
}

// The inputs of an item are settled when the production starts, so what the operator is guided by
// is what leaves the stock when it finishes, whatever happens to the recipe in between.
async function planItem(request: ProductionItemRequest): Promise<{ item: PlannedProductionItem } | Failure> {
  if ("preWeighingId" in request) {
    const preWeighing = await findPreWeighingById(request.preWeighingId);

    if (preWeighing === null) return failure(404, "Pre-weighing not found.");

    return {
      item: {
        productSku: preWeighing.product.sku,
        preWeighingId: preWeighing.id,
        expectedQuantity: preWeighing.quantity,
        inputs: preWeighing.items.map(({ product, weighedQuantity }) => ({
          productSku: product.sku,
          quantity: weighedQuantity,
        })),
      },
    };
  }

  const result = await planPreWeighing(request.productSku, request.quantity);

  if ("failure" in result) return result;

  return {
    item: {
      productSku: result.plan.product.sku,
      preWeighingId: null,
      expectedQuantity: result.plan.quantity,
      inputs: result.plan.items.map(({ product, plannedQuantity }) => ({
        productSku: product.sku,
        quantity: plannedQuantity,
      })),
    },
  };
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export async function startProduction(input: {
  createdById: string;
  items: ProductionItemRequest[];
}): Promise<ProductionResult> {
  const items: PlannedProductionItem[] = [];

  for (const request of input.items) {
    const result = await planItem(request);

    if ("failure" in result) return result;

    items.push(result.item);
  }

  try {
    return { production: await insertProduction({ createdById: input.createdById, items }) };
  } catch (error) {
    // The only unique rule a new production can break is the one that gives a pre-weighing a
    // single item, and leaving it to the database is what holds under simultaneous requests.
    if (isUniqueViolation(error)) return failure(409, "A pre-weighing already guides another production.");

    throw error;
  }
}

// Finishing is where the stock moves: every input leaves at the average cost of that moment, and
// each product comes in costing what its inputs cost, spread over what was really produced.
export async function finishProduction(input: {
  id: string;
  createdById: string;
  items: { id: string; producedQuantity: string }[];
}): Promise<ProductionResult> {
  const { id, createdById } = input;
  const production = await findProductionById(id);

  if (production === null) return notFound;
  if (production.status !== ProductionStatus.IN_PROGRESS) return notInProgress;

  const producedById = new Map(input.items.map((item) => [item.id.toLowerCase(), item.producedQuantity]));

  if (production.items.length !== producedById.size || production.items.some((item) => !producedById.has(item.id))) {
    return failure(409, "The items do not match the items of the production.");
  }

  try {
    await inProductionTransaction(async (tx) => {
      if (!(await markProductionFinished(tx, id))) throw new ProductionAborted(notInProgress);

      for (const item of production.items) {
        const producedQuantity = producedById.get(item.id)!;
        let inputsCost = new Prisma.Decimal(0);

        for (const { id: inputId, product, quantity } of item.inputs) {
          const unitCost = await consumeProductionInput(tx, {
            id: inputId,
            productSku: product.sku,
            quantity,
            createdById,
          });

          inputsCost = inputsCost.add(quantity.mul(unitCost));
        }

        const unitCost = toStoredDecimal(inputsCost.div(producedQuantity));

        if (unitCost === null) {
          throw new ProductionAborted(failure(409, "Produced quantity is out of range for the cost of the inputs."));
        }

        await outputProductionItem(tx, {
          id: item.id,
          productSku: item.product.sku,
          quantity: producedQuantity,
          unitCost,
          createdById,
        });
      }
    });
  } catch (error) {
    if (error instanceof ProductionAborted) return error.result;

    throw error;
  }

  return { production: (await findProductionById(id))! };
}

// A production moves the stock only when it finishes, so giving one up has nothing to put back.
export async function cancelProduction(id: string): Promise<ProductionResult> {
  if ((await findProductionById(id)) === null) return notFound;

  const canceled = await inProductionTransaction(async (tx) => {
    if (!(await markProductionCanceled(tx, id))) return false;

    await releasePreWeighings(tx, id);

    return true;
  });

  if (!canceled) return notInProgress;

  return { production: (await findProductionById(id))! };
}
