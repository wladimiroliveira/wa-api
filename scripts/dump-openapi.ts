import { writeFileSync } from "node:fs";
import { buildApp } from "../src/app.js";

// Serializing the document from the built app, rather than fetching it from a
// running server, is what lets the front end regenerate its types with nothing
// but a checkout: no port listening, no database up.
const app = await buildApp();
const document = app.swagger();

writeFileSync(new URL("../openapi.json", import.meta.url), `${JSON.stringify(document, null, 2)}\n`);
await app.close();

console.log("openapi.json written");
