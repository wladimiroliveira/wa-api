import { prisma } from "../../lib/prisma.js";

type Layout = { order: string[]; widths: Record<string, number> };

const LAYOUT_FIELDS = { select: { tableKey: true, order: true, widths: true } } as const;

// The column stores whatever JSON was written; only the PUT route writes it, and it validates first.
const asLayout = <T extends { widths: unknown }>(row: T) => ({ ...row, widths: row.widths as Layout["widths"] });

export async function listTableLayouts(userId: string) {
  const rows = await prisma.tableLayout.findMany({ where: { userId }, ...LAYOUT_FIELDS, orderBy: { tableKey: "asc" } });

  return rows.map(asLayout);
}

export async function saveTableLayout(userId: string, tableKey: string, layout: Layout) {
  const row = await prisma.tableLayout.upsert({
    where: { userId_tableKey: { userId, tableKey } },
    create: { userId, tableKey, ...layout },
    update: layout,
    ...LAYOUT_FIELDS,
  });

  return asLayout(row);
}

export async function deleteTableLayout(userId: string, tableKey: string): Promise<void> {
  await prisma.tableLayout.deleteMany({ where: { userId, tableKey } });
}
