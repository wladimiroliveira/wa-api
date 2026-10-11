import { z } from "zod";

// Lists are handed out in pages, the newest record first. The cursor is the id of the last record
// of the page before, so a record created in the meantime neither repeats nor hides another.
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.uuid().optional(),
});

type PageQuery = z.infer<typeof pageQuerySchema>;

export const pageSchema = <Item extends z.ZodType>(item: Item) =>
  z.object({ items: z.array(item), nextCursor: z.uuid().nullable() });

// What a findMany takes to read one page. It reads one record past the limit, which is how toPage
// knows whether there is a next page without counting the table.
export const pageArgs = ({ limit, cursor }: PageQuery) => ({
  take: limit + 1,
  ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
  orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
});

export function toPage<Row extends { id: string }>(rows: Row[], { limit }: PageQuery) {
  const items = rows.slice(0, limit);

  return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
}
