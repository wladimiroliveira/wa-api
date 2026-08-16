import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { buildApp } from "../src/server.js";

/** The versioned artifact, at the repository root. */
export const openApiArtifactPath = fileURLToPath(new URL("../openapi.json", import.meta.url));

/**
 * Builds the application only to read the document `@fastify/swagger` assembles, and serializes it
 * with the repository's own Prettier settings, so `prettier --check .` accepts the artifact and the
 * diff stays readable in review.
 *
 * `buildApp()` never touches the database — only `GET /health` queries it, at request time — so the
 * export runs without PostgreSQL. It does need the authentication environment, because
 * `loadAuthConfig()` runs on boot; throwaway values serve, since nothing is signed and none of them
 * reach the document.
 *
 * The local port is dropped on purpose: `servers` is built from `API_PORT`, and keeping it would
 * make the artifact change with the `.env` of whoever exported it.
 */
export async function renderOpenApiDocument(): Promise<string> {
  delete process.env.API_PORT;
  process.env.JWT_SECRET ??= "openapi-export-throwaway-secret-with-32";
  process.env.CORS_ORIGINS ??= "http://localhost:5173";

  const app = await buildApp();

  try {
    await app.ready();

    const options = await resolveConfig(openApiArtifactPath);

    return await format(JSON.stringify(app.swagger()), { ...options, filepath: openApiArtifactPath });
  } finally {
    await app.close();
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  writeFileSync(openApiArtifactPath, await renderOpenApiDocument());
  console.log(`Wrote ${openApiArtifactPath}`);
}
