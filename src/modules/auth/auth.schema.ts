import { z } from "zod";

export const createSessionSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshSessionSchema = z.object({
  refreshToken: z.string().min(1),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type RefreshSessionInput = z.infer<typeof refreshSessionSchema>;
