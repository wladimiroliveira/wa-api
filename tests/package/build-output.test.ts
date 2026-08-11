import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const distRoot = `${projectRoot}dist`;

describe("build output", () => {
  beforeAll(() => {
    rmSync(distRoot, { recursive: true, force: true });
    execFileSync("npm", ["run", "build"], { cwd: projectRoot, stdio: "pipe" });
  }, 180_000);

  test("ships the generated Prisma client", () => {
    expect(existsSync(`${distRoot}/generated/prisma/index.js`)).toBe(true);
  });

  test("compiled server resolves every import", () => {
    const serverUrl = pathToFileURL(`${distRoot}/server.js`).href;

    expect(() =>
      execFileSync(process.execPath, ["--input-type=module", "--eval", `await import(${JSON.stringify(serverUrl)})`], {
        cwd: projectRoot,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
