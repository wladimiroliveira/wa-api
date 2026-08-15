import dotenv, { type DotenvConfigOptions } from "dotenv";
import { expand } from "dotenv-expand";

/**
 * Reads the environment file and resolves the `${VAR}` references inside it, so a value like
 * DATABASE_URL can be assembled from the individual database variables instead of repeating them.
 * `dotenv` alone keeps those references literal — only the Prisma CLI expands them on its own.
 */
export function loadEnv(options?: DotenvConfigOptions): Record<string, string> {
  return expand(dotenv.config(options)).parsed ?? {};
}

loadEnv();
