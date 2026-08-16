import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

function scripts(): Record<string, string> {
  return JSON.parse(readFileSync(`${projectRoot}package.json`, "utf8")).scripts;
}

describe("package.json setup scripts", () => {
  test("dev:full brings the system up from the container to the running server", () => {
    const steps = scripts()
      ["dev:full"]?.split("&&")
      .map((step) => step.trim());

    expect(steps).toEqual(["npm run services:up", "npm run db:migrate", "npm run db:seed", "npm run dev"]);
  });

  test("services:up waits for the database healthcheck before returning", () => {
    expect(scripts()["services:up"]).toContain("--wait");
  });
});
