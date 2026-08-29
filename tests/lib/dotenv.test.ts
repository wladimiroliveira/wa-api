import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDotenv } from "../../src/lib/dotenv.js";

// The shape .example.env documents: the connection string is written once and both schemas reuse it.
const ENV_FILE = [
  "POSTGRES_USER=postgres",
  "POSTGRES_PASSWORD=secret",
  "POSTGRES_DB=wa_api",
  "POSTGRES_HOST=localhost",
  "POSTGRES_PORT=5432",
  "POSTGRES_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}",
  "DATABASE_URL=${POSTGRES_URL}?schema=public",
  "TEST_DATABASE_URL=${POSTGRES_URL}?schema=test",
].join("\n");

function writeEnvFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), "wa-api-dotenv-")), ".env");
  writeFileSync(path, ENV_FILE);
  return path;
}

describe("loadDotenv", () => {
  it("composes DATABASE_URL from the postgres variables", () => {
    const target: Record<string, string> = {};

    loadDotenv({ path: writeEnvFile(), processEnv: target });

    expect(target.DATABASE_URL).toBe("postgresql://postgres:secret@localhost:5432/wa_api?schema=public");
  });

  it("composes TEST_DATABASE_URL from the same connection string", () => {
    const target: Record<string, string> = {};

    loadDotenv({ path: writeEnvFile(), processEnv: target });

    expect(target.TEST_DATABASE_URL).toBe("postgresql://postgres:secret@localhost:5432/wa_api?schema=test");
  });
});
