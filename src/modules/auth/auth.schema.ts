import { z } from "zod";
import { usernameSchema } from "../shared/username.js";
import { permissionSchema } from "../users/roles.schema.js";

export const createSessionSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1),
});

export const refreshSessionSchema = z.object({
  refreshToken: z.string().min(1),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type RefreshSessionInput = z.infer<typeof refreshSessionSchema>;

export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

/** O que o auth.plugin monta em request.auth: identidade sem credencial. */
export const meResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  username: z.string(),
  email: z.string().email(),
  permissions: z.array(permissionSchema),
});
