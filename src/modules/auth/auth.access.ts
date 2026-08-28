import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Permission } from "../../generated/prisma/index.js";
import { verifyAccessToken } from "./auth.jwt.js";
import { hasPermission } from "./auth.permissions.js";

export const PUBLIC = "public" as const;
export const AUTHENTICATED = "authenticated" as const;

export type AccessRule = typeof PUBLIC | typeof AUTHENTICATED | Permission;

export type AuthenticatedUser = { id: string; permissions: Permission[] };
export type AuthenticatedUserLoader = (userId: string) => Promise<AuthenticatedUser | null>;

declare module "fastify" {
  interface FastifyContextConfig {
    auth?: AccessRule;
  }

  interface FastifyRequest {
    currentUser?: AuthenticatedUser;
  }
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;

  if (header === undefined || !header.startsWith("Bearer ")) return null;

  const token = header.slice("Bearer ".length).trim();

  return token === "" ? null : token;
}

const unauthorized = (reply: FastifyReply) => reply.code(401).send({ message: "Authentication required." });
const forbidden = (reply: FastifyReply) => reply.code(403).send({ message: "Permission denied." });

// Hooks are scoped in Fastify: adding these inside the plugin that registers the application's
// routes leaves the documentation routes, registered elsewhere, untouched.
export function applyAccessControl(app: FastifyInstance, loadUser: AuthenticatedUserLoader): void {
  // A route with no declared access is a route nobody decided about. Failing at registration turns
  // that into an application that does not start, instead of an endpoint quietly open in production.
  app.addHook("onRoute", (route) => {
    if (route.config?.auth === undefined) {
      throw new Error(
        `Route ${route.method} ${route.url} does not declare its access. Use PUBLIC, AUTHENTICATED or a Permission.`,
      );
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    const rule = request.routeOptions.config.auth;

    if (rule === PUBLIC) return;

    const token = bearerToken(request);

    if (token === null) return unauthorized(reply);

    const payload = verifyAccessToken(request.server, token);

    if (payload === null) return unauthorized(reply);

    const user = await loadUser(payload.sub);

    if (user === null) return unauthorized(reply);

    request.currentUser = user;

    if (rule === AUTHENTICATED) return;

    if (!hasPermission(user.permissions, rule as Permission)) return forbidden(reply);
  });
}
