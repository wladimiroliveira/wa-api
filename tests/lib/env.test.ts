import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { loadEnv } from "../../src/lib/env.js";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const examplePath = `${projectRoot}.example.env`;

function exampleEnv(): Record<string, string> {
  return loadEnv({ path: examplePath, processEnv: {} });
}

describe("loadEnv", () => {
  test("assembles DATABASE_URL from the individual database variables", () => {
    const env = exampleEnv();

    expect(env.DATABASE_URL).toBe(
      `postgresql://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}` +
        `@${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${env.POSTGRES_DB}?schema=public`,
    );
  });

  test("leaves no unresolved reference behind", () => {
    const unresolved = Object.entries(exampleEnv())
      .filter(([, value]) => value.includes("${"))
      .map(([name]) => name);

    expect(unresolved).toEqual([]);
  });
});

describe("environment bootstrap", () => {
  test.each([
    ["src/server.ts", "./lib/env.js"],
    ["prisma/seed.ts", "../src/lib/env.js"],
  ])("%s loads the expanding loader instead of dotenv/config", (file, specifier) => {
    const source = readFileSync(`${projectRoot}${file}`, "utf8");

    expect(source).toContain(`import "${specifier}"`);
    expect(source).not.toContain('import "dotenv/config"');
  });
});
