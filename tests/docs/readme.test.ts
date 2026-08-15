import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const assignmentPattern = /^([A-Z][A-Z0-9_]*)=/;

/** Scripts that exist for tooling only and have no place in the documented table. */
const INTERNAL_SCRIPTS = ["prepare", "build:prisma-client"];

function readme(): string {
  return readFileSync(`${projectRoot}README.md`, "utf8");
}

function structureBlock(): string {
  const source = readme();
  const start = source.indexOf("## Project structure");

  return source.slice(start, source.indexOf("```", source.indexOf("```", start) + 1));
}

function documentedScripts(): string[] {
  return [...readme().matchAll(/^\| `npm (?:run )?([\w:]+)`/gm)].map(([, name]) => name);
}

function documentedVariables(): string[] {
  return [...readme().matchAll(/^\| `([A-Z][A-Z0-9_]*)`/gm)].map(([, name]) => name);
}

describe("README project structure", () => {
  test("lists every module directory", () => {
    const modules = readdirSync(`${projectRoot}src/modules`, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const undocumented = modules.filter((name) => !structureBlock().includes(`${name}/`));

    expect(undocumented).toEqual([]);
  });

  test("lists every file under src/lib", () => {
    const files = readdirSync(`${projectRoot}src/lib`).filter((entry) => entry.endsWith(".ts"));

    const undocumented = files.filter((file) => !structureBlock().includes(`lib/${file}`));

    expect(undocumented).toEqual([]);
  });
});

describe("README scripts table", () => {
  test("documents every script the manifest exposes", () => {
    const manifest = JSON.parse(readFileSync(`${projectRoot}package.json`, "utf8"));
    const documented = documentedScripts();

    const undocumented = Object.keys(manifest.scripts)
      .filter((name) => !INTERNAL_SCRIPTS.includes(name))
      .filter((name) => !documented.includes(name));

    expect(undocumented).toEqual([]);
  });

  test("documents no script the manifest dropped", () => {
    const manifest = JSON.parse(readFileSync(`${projectRoot}package.json`, "utf8"));

    const stale = documentedScripts().filter((name) => !(name in manifest.scripts));

    expect(stale).toEqual([]);
  });
});

describe("README environment table", () => {
  test("documents every variable the example environment declares", () => {
    const declared = readFileSync(`${projectRoot}.example.env`, "utf8")
      .split("\n")
      .flatMap((line) => {
        const match = assignmentPattern.exec(line);
        return match ? [match[1]] : [];
      });
    const documented = documentedVariables();

    const undocumented = declared.filter((name) => !documented.includes(name));

    expect(undocumented).toEqual([]);
  });
});
