import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const interpolationPattern = /\$\{([A-Z][A-Z0-9_]*)/g;
const assignmentPattern = /^([A-Z][A-Z0-9_]*)=/;
const credentialPattern = /^\s+(POSTGRES_(?:USER|PASSWORD|DB)):\s*(.+)$/gm;

function compose(): string {
  return readFileSync(`${projectRoot}docker-compose.yml`, "utf8");
}

function declaredInExample(): string[] {
  return readFileSync(`${projectRoot}.example.env`, "utf8")
    .split("\n")
    .flatMap((line) => {
      const match = assignmentPattern.exec(line);
      return match ? [match[1]] : [];
    });
}

describe("docker-compose.yml", () => {
  test("interpolates only variables the example environment declares", () => {
    const declared = declaredInExample();

    const undeclared = [...new Set([...compose().matchAll(interpolationPattern)].map(([, name]) => name))].filter(
      (name) => !declared.includes(name),
    );

    expect(undeclared).toEqual([]);
  });

  test("takes the database credentials from the environment", () => {
    const hardcoded = [...compose().matchAll(credentialPattern)]
      .filter(([, , value]) => !value.startsWith("${"))
      .map(([, name]) => name);

    expect(hardcoded).toEqual([]);
  });

  test("publishes the port the application connects to", () => {
    expect(compose()).toContain("${POSTGRES_PORT");
  });

  test("checks health against the same role and database", () => {
    const healthcheck = compose().slice(compose().indexOf("healthcheck:"));

    expect(healthcheck).toContain("${POSTGRES_USER");
    expect(healthcheck).toContain("${POSTGRES_DB");
  });
});
