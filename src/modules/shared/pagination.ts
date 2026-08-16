import { z } from "zod";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

/**
 * Controles de página das rotas de razão. `z.coerce` porque a querystring só
 * traz string, e o teto existe para que nenhum cliente consiga pedir a tabela
 * inteira de volta pela porta da frente.
 */
export const cursorPageQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  cursor: z.string().uuid().optional(),
});

export type CursorPage = z.infer<typeof cursorPageQuerySchema>;

/** Envelope de página: os registros mais o cursor da próxima, `null` no fim. */
export function pageResponseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item), nextCursor: z.string().uuid().nullable() });
}

/**
 * Argumentos de keyset para o Prisma. Ordena por `createdAt` desc com desempate
 * por `id`: `CURRENT_TIMESTAMP` é o horário de início da transação, então uma
 * produção que consome vários insumos grava todos os movimentos no mesmo
 * instante — sem desempate, essas linhas trocariam de lugar entre uma página e
 * a seguinte. Pede uma linha além do limite para saber se há próxima página sem
 * uma segunda consulta de contagem.
 */
export function cursorPageArgs(page: CursorPage) {
  return {
    take: page.limit + 1,
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
  };
}

/** Descarta a linha-sonda e aponta o cursor para o último registro entregue. */
export function toPage<T extends { id: string }>(rows: T[], limit: number) {
  const hasNext = rows.length > limit;
  const data = hasNext ? rows.slice(0, limit) : rows;

  return { data, nextCursor: hasNext ? data[data.length - 1]!.id : null };
}
