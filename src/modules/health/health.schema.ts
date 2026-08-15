import { z } from "zod";

/** Serve o 200 e o 503: só muda o valor de cada campo. */
export const healthResponseSchema = z.object({
  status: z.enum(["ok", "error"]),
  database: z.enum(["up", "down"]),
});
