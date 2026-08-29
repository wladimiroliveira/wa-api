import { z } from "zod";
import { loadDotenv } from "./dotenv.js";

// Loading the .env here, and not at the entrypoint, keeps the guarantee independent of import order:
// whoever reaches this module reads an environment that is already complete.
loadDotenv();

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin !== ""),
    ),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${details}`);
  }

  return result.data;
}

let cached: Env | null = null;

export function loadEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
