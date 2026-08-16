import prisma from "../../lib/prisma.js";
import { cursorPageArgs, toPage } from "../shared/pagination.js";
import { dateRangeWhere } from "../shared/date-range.js";
import type { ProductionQuery } from "./production.schema.js";

export async function listProductions(query: ProductionQuery) {
  const rows = await prisma.production.findMany({
    where: dateRangeWhere(query),
    include: { recipe: true },
    ...cursorPageArgs(query),
  });

  return toPage(rows, query.limit);
}

export function getProduction(id: string) {
  return prisma.production.findUnique({
    where: { id },
    include: { recipe: true, movements: { include: { supply: true } } },
  });
}
