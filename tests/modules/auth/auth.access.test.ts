import fastify, { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { Permission } from "../../../src/generated/prisma/index.js";
import { registerAccessToken, signAccessToken } from "../../../src/modules/auth/auth.jwt.js";
import { applyAccessControl, AUTHENTICATED, AuthenticatedUser, PUBLIC } from "../../../src/modules/auth/auth.access.js";

const SECRET = "a-secret-long-enough-to-be-taken-seriously";
const USER: AuthenticatedUser = { id: "0199a1f0-0000-7000-8000-000000000001", permissions: [Permission.SALES_READ] };

async function appWithRoutes(register: (scope: FastifyInstance) => void, user: AuthenticatedUser | null = USER) {
  const app = fastify();
  await registerAccessToken(app, { secret: SECRET, ttlMinutes: 15 });

  await app.register(async (scope) => {
    applyAccessControl(scope, async (userId) => (user !== null && user.id === userId ? user : null));
    register(scope);
  });

  await app.ready();

  return app;
}

const bearer = (app: FastifyInstance, userId = USER.id) => ({
  authorization: `Bearer ${signAccessToken(app, userId)}`,
});

describe("applyAccessControl", () => {
  it("refuses to register a route that declares no access", async () => {
    await expect(
      appWithRoutes((scope) => {
        scope.get("/forgotten", async () => ({ ok: true }));
      }),
    ).rejects.toThrow(/GET \/forgotten/);
  });

  it("lets a public route through without a token", async () => {
    const app = await appWithRoutes((scope) => {
      scope.get("/health", { config: { auth: PUBLIC } }, async () => ({ ok: true }));
    });

    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);

    await app.close();
  });

  it("answers 401 when an authenticated route gets no token", async () => {
    const app = await appWithRoutes((scope) => {
      scope.get("/me", { config: { auth: AUTHENTICATED } }, async () => ({ ok: true }));
    });

    expect((await app.inject({ method: "GET", url: "/me" })).statusCode).toBe(401);

    await app.close();
  });

  it("answers 401 for a token that does not verify", async () => {
    const app = await appWithRoutes((scope) => {
      scope.get("/me", { config: { auth: AUTHENTICATED } }, async () => ({ ok: true }));
    });

    const response = await app.inject({ method: "GET", url: "/me", headers: { authorization: "Bearer garbage" } });

    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it("answers 401 when the token names a user who no longer answers", async () => {
    const app = await appWithRoutes((scope) => {
      scope.get("/me", { config: { auth: AUTHENTICATED } }, async () => ({ ok: true }));
    }, null);

    const response = await app.inject({ method: "GET", url: "/me", headers: bearer(app) });

    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it("attaches the authenticated user to the request", async () => {
    const app = await appWithRoutes((scope) => {
      scope.get("/me", { config: { auth: AUTHENTICATED } }, async (request) => request.currentUser);
    });

    const response = await app.inject({ method: "GET", url: "/me", headers: bearer(app) });

    expect(response.json()).toEqual(USER);

    await app.close();
  });

  it("lets a permission the user holds through", async () => {
    const app = await appWithRoutes((scope) => {
      scope.get("/sales", { config: { auth: Permission.SALES_READ } }, async () => ({ ok: true }));
    });

    expect((await app.inject({ method: "GET", url: "/sales", headers: bearer(app) })).statusCode).toBe(200);

    await app.close();
  });

  it("answers 403 for a permission the user does not hold", async () => {
    const app = await appWithRoutes((scope) => {
      scope.post("/sales", { config: { auth: Permission.SALES_CREATE } }, async () => ({ ok: true }));
    });

    expect((await app.inject({ method: "POST", url: "/sales", headers: bearer(app) })).statusCode).toBe(403);

    await app.close();
  });
});
