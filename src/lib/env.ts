// Loading the .env here, and not at the entrypoint, keeps the guarantee independent of import order:
// whoever reaches this module reads an environment that is already complete.
import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
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
