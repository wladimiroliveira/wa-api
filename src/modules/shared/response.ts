import { z } from "zod";

/** Prisma.Decimal chega como objeto; valueOf() devolve o número, então coerce resolve sem transform. */
export const decimalSchema = z.coerce.number();

/** Date do Prisma vira ISO 8601 no corpo e `string / date-time` no OpenAPI. */
export const timestampSchema = z.coerce.date();

/**
 * Cobre os três formatos de erro que a API produz hoje: `{ message }` das rotas,
 * `{ code, message }` dos erros de domínio e o `{ statusCode, code, error, message }`
 * que o Fastify monta a partir da validação do Zod. Em POST /recipes os dois
 * últimos dividem o status 400, então um schema estrito quebraria a serialização.
 */
export const errorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  statusCode: z.number().optional(),
  error: z.string().optional(),
});

/** 204 não tem corpo; z.void() (não z.null()) porque o type provider tipa reply.send() como aceitando 0 argumentos só quando o schema é void. */
export const noContentSchema = z.void();

/** Espalhado nas rotas que exigem permissão. */
export const protectedErrors = { 401: errorSchema, 403: errorSchema } as const;
