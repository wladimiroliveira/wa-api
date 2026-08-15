import type { FastifyInstance } from "fastify";
import { fastifyJwt } from "@fastify/jwt";
import type { Permission } from "../../generated/prisma/index.js";
import { loadAuthConfig } from "./auth.config.js";
import { effectivePermissions } from "./auth.permissions.js";
import { isAuthGuard } from "./auth.guard.js";
import { findActiveUserWithRole } from "./auth.repository.js";

export type AuthContext = {
  user: { id: string; name: string; username: string; email: string };
  permissions: Set<Permission>;
};

declare module "fastify" {
  interface FastifyContextConfig {
    public?: boolean;
  }

  interface FastifyRequest {
    auth: AuthContext;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

/**
 * Prefixos servidos por plugins de terceiros, que não têm como declarar
 * `config: { public: true }` nas próprias rotas. O hook `onRequest` alcança
 * essas rotas mesmo tendo sido adicionado depois delas, então a isenção
 * precisa ser explícita — não dá para contar com a ordem de registro.
 */
const PUBLIC_PREFIXES = ["/docs"];

function isPublicPrefix(url: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => url === prefix || url.startsWith(`${prefix}/`));
}

/** Registra a autenticação na instância raiz, antes das rotas da aplicação. */
export async function registerAuth(app: FastifyInstance): Promise<void> {
  const { jwtSecret } = loadAuthConfig();

  await app.register(fastifyJwt, { secret: jwtSecret });

  // Só reserva o campo; o hook abaixo o preenche em toda rota não pública.
  app.decorateRequest("auth");

  // Default-deny na inicialização: rota que não declara nada não sobe.
  app.addHook("onRoute", (route) => {
    if (route.config?.public || isPublicPrefix(route.url)) return;

    const preHandlers = [route.preHandler ?? []].flat();
    if (preHandlers.some(isAuthGuard)) return;

    const method = [route.method].flat().join("/");
    throw new Error(
      `Rota ${method} ${route.url} não declara requireAuth(), requirePermission() nem config: { public: true }`,
    );
  });

  app.addHook("onRequest", async (request, reply) => {
    // routeOptions.url é o padrão da rota, sem query string.
    if (request.routeOptions.config?.public || isPublicPrefix(request.routeOptions.url ?? request.url)) return;

    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ message: "Autenticação necessária" });
    }

    const user = await findActiveUserWithRole(request.user.sub);
    if (!user) return reply.status(401).send({ message: "Autenticação necessária" });

    request.auth = {
      user: { id: user.id, name: user.name, username: user.username, email: user.email },
      permissions: effectivePermissions({
        rolePermissions: user.role?.permissions ?? [],
        grantedPermissions: user.grantedPermissions,
        deniedPermissions: user.deniedPermissions,
      }),
    };
  });
}
