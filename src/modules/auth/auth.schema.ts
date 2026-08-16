import { z } from "zod";
import { usernameSchema } from "../shared/username.js";
import { permissionSchema } from "../users/roles.schema.js";

export const createSessionSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1),
});

/**
 * Tudo opcional porque o modo cookie não manda corpo nenhum — e o Fastify
 * entrega `null`, não `undefined`, quando o corpo não vem. A rota é quem cobra
 * o token, do corpo ou do cookie.
 */
export const refreshSessionSchema = z
  .object({
    refreshToken: z.string().min(1).optional(),
  })
  .nullish();

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type RefreshSessionInput = z.infer<typeof refreshSessionSchema>;

/** O refresh só aparece aqui no modo corpo; no modo cookie ele sai em Set-Cookie. */
export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
});

/** O que o auth.plugin monta em request.auth: identidade sem credencial. */
export const meResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  username: z.string(),
  email: z.string().email(),
  permissions: z.array(permissionSchema),
});
