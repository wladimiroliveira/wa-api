import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const sourceRoot = `${projectRoot}src`;
const generatedPrefix = "generated/";
const importPattern = /(?:from|import)\s+"([^"]+)"/g;

function listSourceFiles(): string[] {
  return readdirSync(sourceRoot, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts") && !entry.startsWith(generatedPrefix))
    .map((entry) => `${sourceRoot}/${entry}`);
}

function packageNameOf(specifier: string): string {
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

function importedPackages(): string[] {
  const packages = new Set<string>();

  for (const file of listSourceFiles()) {
    const source = readFileSync(file, "utf8");

    for (const [, specifier] of source.matchAll(importPattern)) {
      if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
      packages.add(packageNameOf(specifier));
    }
  }

  return [...packages].sort();
}

describe("package.json runtime dependencies", () => {
  test("every package imported by src is declared in dependencies", () => {
    const manifest = JSON.parse(readFileSync(`${projectRoot}package.json`, "utf8"));
    const declared = Object.keys(manifest.dependencies ?? {});

    const missing = importedPackages().filter((name) => !declared.includes(name));

    expect(missing).toEqual([]);
  });
});
