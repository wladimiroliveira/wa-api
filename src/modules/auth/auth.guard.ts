import type { preHandlerAsyncHookHandler } from "fastify";
import type { Permission } from "../../generated/prisma/index.js";

export const AUTH_GUARD = Symbol.for("wa-api.auth-guard");

export type AuthGuard = preHandlerAsyncHookHandler & { [AUTH_GUARD]: Permission | null };

function markGuard(handler: preHandlerAsyncHookHandler, permission: Permission | null): AuthGuard {
  return Object.assign(handler, { [AUTH_GUARD]: permission });
}

/** Basta estar autenticado; nenhuma permissão de módulo é exigida. */
export function requireAuth(): AuthGuard {
  return markGuard(async () => {}, null);
}

export function requirePermission(permission: Permission): AuthGuard {
  return markGuard(async (request, reply) => {
    if (!request.auth.permissions.has(permission)) {
      return reply.status(403).send({ message: "Permissão insuficiente para esta operação" });
    }
  }, permission);
}

export function isAuthGuard(handler: unknown): boolean {
  return typeof handler === "function" && AUTH_GUARD in handler;
}
