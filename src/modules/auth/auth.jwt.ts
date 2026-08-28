import fastifyJwt from "@fastify/jwt";
import { FastifyInstance } from "fastify";

// The payload carries only the subject. Permissions travel from the database on every request, so
// putting them in here would make that freshness a lie.
export type AccessTokenPayload = { sub: string; iat: number; exp: number };

export async function registerAccessToken(
  app: FastifyInstance,
  options: { secret: string; ttlMinutes: number },
): Promise<void> {
  await app.register(fastifyJwt, {
    secret: options.secret,
    sign: { expiresIn: `${options.ttlMinutes}m` },
  });
}

export function signAccessToken(app: FastifyInstance, userId: string): string {
  return app.jwt.sign({ sub: userId });
}

export function verifyAccessToken(app: FastifyInstance, token: string): AccessTokenPayload | null {
  try {
    return app.jwt.verify<AccessTokenPayload>(token);
  } catch {
    return null;
  }
}
