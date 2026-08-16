import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { loadAuthConfig } from "./auth.config.js";

export const REFRESH_COOKIE = "refreshToken";
export const CSRF_COOKIE = "csrfToken";
export const CSRF_HEADER = "x-csrf-token";
export const DELIVERY_HEADER = "x-refresh-delivery";

const CSRF_TOKEN_BYTES = 32;

/** As três rotas de sessão vivem sob /sessions: o cookie não precisa sair daí. */
const cookieOptions = { secure: true, sameSite: "strict", path: "/sessions" } as const;

function headerValue(req: FastifyRequest, name: string): string | undefined {
  const value = req.headers[name];

  return typeof value === "string" ? value : undefined;
}

/**
 * Cliente não-navegador pede o token no corpo. O pedido só vale no login, onde
 * ainda não existe cookie: quem já apresenta cookie recebe cookie, sempre.
 */
export function wantsBodyDelivery(req: FastifyRequest): boolean {
  return headerValue(req, DELIVERY_HEADER) === "body";
}

export function setSessionCookies(reply: FastifyReply, refreshToken: string): void {
  const maxAge = loadAuthConfig().refreshTokenTtlDays * 24 * 60 * 60;

  reply.setCookie(REFRESH_COOKIE, refreshToken, { ...cookieOptions, httpOnly: true, maxAge });
  // Legível pelo JavaScript de propósito: o cliente precisa ecoá-lo no header.
  reply.setCookie(CSRF_COOKIE, randomBytes(CSRF_TOKEN_BYTES).toString("base64url"), {
    ...cookieOptions,
    httpOnly: false,
    maxAge,
  });
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, { ...cookieOptions, httpOnly: true });
  reply.clearCookie(CSRF_COOKIE, { ...cookieOptions, httpOnly: false });
}

/**
 * Double submit: só quem lê a página consegue repetir o cookie no header, e
 * `SameSite=Strict` já barra o caso comum. É a segunda tranca, não a primeira.
 */
export function hasValidCsrfToken(req: FastifyRequest): boolean {
  const cookie = req.cookies[CSRF_COOKIE];
  const header = headerValue(req, CSRF_HEADER);

  if (!cookie || !header || header.length !== cookie.length) return false;

  const encoder = new TextEncoder();

  return timingSafeEqual(encoder.encode(header), encoder.encode(cookie));
}
