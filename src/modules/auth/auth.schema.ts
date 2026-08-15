import { z } from "zod";
import { usernameSchema } from "../shared/username.js";

export const createSessionSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1),
});

export const refreshSessionSchema = z.object({
  refreshToken: z.string().min(1),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type RefreshSessionInput = z.infer<typeof refreshSessionSchema>;
