import { z } from "zod";

const authEnvSchema = z.object({
  JWT_SECRET: z.string().min(32, "JWT_SECRET precisa de ao menos 32 caracteres"),
  CORS_ORIGINS: z.string().min(1, "CORS_ORIGINS precisa listar ao menos uma origem"),
  ACCESS_TOKEN_TTL: z.string().min(1).default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
});

export type AuthConfig = {
  jwtSecret: string;
  accessTokenTtl: string;
  refreshTokenTtlDays: number;
  corsOrigins: string[];
  loginRateLimitMax: number;
};

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const parsed = authEnvSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Configuração de autenticação inválida — ${details}`);
  }

  return {
    jwtSecret: parsed.data.JWT_SECRET,
    accessTokenTtl: parsed.data.ACCESS_TOKEN_TTL,
    refreshTokenTtlDays: parsed.data.REFRESH_TOKEN_TTL_DAYS,
    loginRateLimitMax: parsed.data.LOGIN_RATE_LIMIT_MAX,
    corsOrigins: parsed.data.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}
