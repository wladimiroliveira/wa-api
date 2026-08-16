import { z } from "zod";

/**
 * Recorte por período das listagens de razão. Aceita data pura (`2026-08-01`) e
 * instante ISO 8601. Intervalo invertido é recusado em vez de devolver vazio em
 * silêncio, que é sempre erro de quem chamou.
 */
export const dateRangeFields = {
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};

/** Aplica a checagem do intervalo a qualquer query que já carregue `from` e `to`. */
export function refineDateRange<T extends z.ZodObject<z.ZodRawShape>>(schema: T) {
  return schema.refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "O início do intervalo não pode ser posterior ao fim",
    path: ["from"],
  });
}

export const dateRangeQuerySchema = refineDateRange(z.object(dateRangeFields));

export type DateRange = { from?: Date; to?: Date };

/**
 * Filtro semiaberto `[from, to)`: janelas consecutivas se encaixam sem repetir
 * o registro da fronteira.
 */
export function dateRangeWhere(range: DateRange) {
  const createdAt = {
    ...(range.from ? { gte: range.from } : {}),
    ...(range.to ? { lt: range.to } : {}),
  };

  return Object.keys(createdAt).length > 0 ? { createdAt } : {};
}
