import fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { describe, expect, it } from "vitest";
import routes from "../src/routes.js";
import { API_PREFIX } from "../src/lib/api-version.js";
import { registerAccessToken } from "../src/modules/auth/auth.jwt.js";

const SECRET = "a-secret-long-enough-to-be-taken-seriously";

// printRoutes prints the method and the path, but not the rule the route declares, and a snapshot
// that cannot show a loosened permission does not do the job the spec asks of it. Registering the
// real route tree behind an onRoute hook records the declaration itself.
async function routeInventory(): Promise<string[]> {
  const app = fastify();
  const inventory: string[] = [];

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await registerAccessToken(app, { secret: SECRET, ttlMinutes: 15 });

  app.addHook("onRoute", (route) => {
    inventory.push(`${[route.method].flat().join(", ")} ${route.url} -> ${String(route.config?.auth)}`);
  });

  await app.register(routes, { prefix: API_PREFIX });
  await app.ready();
  await app.close();

  return inventory.sort();
}

// Every route and the rule it declares, in one readable list. Loosening a permission stops being a
// one-word change buried in a module and starts being a line in the diff of this snapshot.
describe("routes inventory", () => {
  it("matches the recorded access of every route", async () => {
    expect((await routeInventory()).join("\n")).toMatchSnapshot();
  });
});
