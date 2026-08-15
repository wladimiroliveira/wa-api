import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { loadAuthConfig } from "../../src/modules/auth/auth.config.js";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const examplePath = `${projectRoot}.example.env`;
const generatedPrefix = "generated/";
const assignmentPattern = /^([A-Z][A-Z0-9_]*)=(.*)$/;
const processEnvPattern = /process\.env\.([A-Z][A-Z0-9_]*)/g;
const prismaEnvPattern = /env\("([A-Z][A-Z0-9_]*)"\)/g;

type Declaration = { name: string; value: string; labelled: boolean };

function exampleLines(): string[] {
  return readFileSync(examplePath, "utf8").split("\n");
}

function isLabel(line: string): boolean {
  const comment = line.trim();
  return comment.startsWith("#") && /[a-z]/.test(comment);
}

function declarations(): Declaration[] {
  const lines = exampleLines();

  return lines.flatMap((line, index) => {
    const match = assignmentPattern.exec(line);
    if (!match) return [];

    const [, name, rawValue] = match;
    const previous = lines[index - 1] ?? "";

    return [{ name, value: rawValue.trim().replace(/^"(.*)"$/, "$1"), labelled: isLabel(previous) }];
  });
}

function sourceFiles(): string[] {
  const sources = readdirSync(`${projectRoot}src`, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts") && !entry.startsWith(generatedPrefix))
    .map((entry) => `${projectRoot}src/${entry}`);

  return [
    ...sources,
    `${projectRoot}prisma/seed.ts`,
    `${projectRoot}prisma/schema.prisma`,
    `${projectRoot}docker-compose.yml`,
  ];
}

function readSources(): { path: string; content: string }[] {
  return sourceFiles().map((path) => ({ path, content: readFileSync(path, "utf8") }));
}

function referencedNames(): string[] {
  const names = new Set<string>();

  for (const { path, content } of readSources()) {
    const pattern = path.endsWith(".prisma") ? prismaEnvPattern : processEnvPattern;

    for (const [, name] of content.matchAll(pattern)) names.add(name);
  }

  return [...names].sort();
}

describe(".example.env", () => {
  test("declares every variable the application reads from the environment", () => {
    const declared = declarations().map(({ name }) => name);

    const missing = referencedNames().filter((name) => !declared.includes(name));

    expect(missing).toEqual([]);
  });

  test("declares no variable the codebase never mentions", () => {
    const sources = readSources();
    const composed = readFileSync(examplePath, "utf8");

    const orphans = declarations()
      .map(({ name }) => name)
      .filter((name) => !composed.includes(`\${${name}}`))
      .filter((name) => !sources.some(({ content }) => content.includes(name)));

    expect(orphans).toEqual([]);
  });

  test("carries values the authentication config accepts", () => {
    const env = Object.fromEntries(declarations().map(({ name, value }) => [name, value]));

    expect(() => loadAuthConfig(env)).not.toThrow();
  });

  test("labels every variable with a comment line above it", () => {
    const unlabelled = declarations()
      .filter(({ labelled }) => !labelled)
      .map(({ name }) => name);

    expect(unlabelled).toEqual([]);
  });
});
