import { MeasurementUnit, Prisma, ProductKind } from "../../generated/prisma/index.js";
import { prisma } from "../../lib/prisma.js";
import { setMinimumQuantity } from "../stock/stock.repository.js";

const PRODUCT_FIELDS = {
  select: {
    sku: true,
    gtin: true,
    description: true,
    kind: true,
    unit: true,
    isActive: true,
    stock: { select: { minimumQuantity: true } },
  },
} as const;

type ProductRow = Prisma.ProductGetPayload<typeof PRODUCT_FIELDS>;

function toProduct({ stock, ...product }: ProductRow) {
  return { ...product, minimumQuantity: stock?.minimumQuantity?.toString() ?? null };
}

const toOptionalProduct = (row: ProductRow | null) => (row === null ? null : toProduct(row));

export async function listProducts() {
  return (await prisma.product.findMany({ ...PRODUCT_FIELDS, orderBy: { description: "asc" } })).map(toProduct);
}

export async function findProductBySku(sku: string) {
  return toOptionalProduct(await prisma.product.findUnique({ where: { sku }, ...PRODUCT_FIELDS }));
}

export async function findProductByDescription(description: string) {
  return toOptionalProduct(await prisma.product.findUnique({ where: { description }, ...PRODUCT_FIELDS }));
}

export async function findProductByGtin(gtin: string) {
  return toOptionalProduct(await prisma.product.findUnique({ where: { gtin }, ...PRODUCT_FIELDS }));
}

export function insertProduct({
  minimumQuantity,
  ...input
}: {
  description: string;
  kind: ProductKind;
  unit: MeasurementUnit;
  gtin?: string;
  minimumQuantity?: string;
}) {
  return prisma.$transaction(async (client) => {
    const { sku } = await client.product.create({ data: input, select: { sku: true } });

    if (minimumQuantity !== undefined) await setMinimumQuantity(client, { productSku: sku, minimumQuantity });

    return toProduct(await client.product.findUniqueOrThrow({ where: { sku }, ...PRODUCT_FIELDS }));
  });
}

export function updateProduct(
  sku: string,
  {
    minimumQuantity,
    ...changes
  }: { description?: string; gtin?: string | null; isActive?: boolean; minimumQuantity?: string | null },
) {
  return prisma.$transaction(async (client) => {
    await client.product.update({ where: { sku }, data: changes, select: { sku: true } });

    if (minimumQuantity !== undefined) await setMinimumQuantity(client, { productSku: sku, minimumQuantity });

    return toProduct(await client.product.findUniqueOrThrow({ where: { sku }, ...PRODUCT_FIELDS }));
  });
}
