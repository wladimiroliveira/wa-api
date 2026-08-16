import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { openApiArtifactPath, renderOpenApiDocument } from "../../scripts/export-openapi.js";

describe("openapi.json artifact", () => {
  // O CI trava a mesma divergência com `npm run openapi:export && git diff --exit-code`.
  // Aqui a suíte acusa antes, sem depender do push.
  test("matches the document the application serves", async () => {
    expect(readFileSync(openApiArtifactPath, "utf8")).toBe(await renderOpenApiDocument());
  });
});
