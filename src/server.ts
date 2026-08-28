import { buildApp } from "./app.js";
import { loadEnv } from "./lib/env.js";

const env = loadEnv();
const app = await buildApp();

await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
console.log("Server is running");
