import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Response as InjectResponse } from "light-my-request";
import { buildApp } from "../../../src/server.js";
import prisma from "../../../src/lib/prisma.js";
import { hashPassword } from "../../../src/modules/auth/auth.password.js";
import { Permission } from "../../../src/generated/prisma/index.js";

const PASSWORD = "senha-de-teste";

type Cookie = { name: string; value: string; httpOnly?: boolean; secure?: boolean; sameSite?: string; path?: string };

function cookieNamed(res: InjectResponse, name: string): Cookie | undefined {
  return (res.cookies as Cookie[]).find((cookie) => cookie.name === name);
}

describe("refresh token em cookie", () => {
  let app: FastifyInstance;
  const createdUserIds: string[] = [];
  let username: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    username = `cookie-${crypto.randomUUID().slice(0, 8)}`;
    const user = await prisma.user.create({
      data: {
        name: "Cookie User",
        username,
        email: `${username}@example.test`,
        passwordHash: await hashPassword(PASSWORD),
        grantedPermissions: [Permission.SUPPLIES_READ],
      },
    });
    createdUserIds.push(user.id);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  });

  /** Login no modo padrão: o refresh volta em cookie, nunca no corpo. */
  async function loginWithCookies() {
    const res = await app.inject({ method: "POST", url: "/sessions", payload: { username, password: PASSWORD } });
    const refresh = cookieNamed(res, "refreshToken");
    const csrf = cookieNamed(res, "csrfToken");

    return {
      res,
      accessToken: res.json().accessToken as string,
      cookies: { refreshToken: refresh?.value ?? "", csrfToken: csrf?.value ?? "" },
    };
  }

  describe("POST /sessions", () => {
    test("sem header de entrega, o corpo traz só o access token", async () => {
      const { res } = await loginWithCookies();

      expect(res.statusCode).toBe(200);
      expect(res.json().accessToken).toEqual(expect.any(String));
      expect(res.json()).not.toHaveProperty("refreshToken");
    });

    test("o refresh vai em cookie httpOnly, Secure, SameSite=Strict e escopado em /sessions", async () => {
      const { res } = await loginWithCookies();

      expect(cookieNamed(res, "refreshToken")).toMatchObject({
        value: expect.any(String),
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
        path: "/sessions",
      });
    });

    test("o token anti-CSRF vai em cookie legível pelo JavaScript", async () => {
      const { res } = await loginWithCookies();

      expect(cookieNamed(res, "csrfToken")).toMatchObject({
        value: expect.any(String),
        secure: true,
        sameSite: "Strict",
        path: "/sessions",
      });
      expect(cookieNamed(res, "csrfToken")?.httpOnly).toBeFalsy();
    });

    test("com X-Refresh-Delivery: body o par volta no corpo e nenhum cookie é gravado", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/sessions",
        headers: { "x-refresh-delivery": "body" },
        payload: { username, password: PASSWORD },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().refreshToken).toEqual(expect.any(String));
      expect(res.cookies).toHaveLength(0);
    });
  });

  describe("POST /sessions/refresh", () => {
    test("rotaciona pelo cookie e devolve o novo refresh só em cookie", async () => {
      const { cookies } = await loginWithCookies();

      const res = await app.inject({
        method: "POST",
        url: "/sessions/refresh",
        cookies,
        headers: { "x-csrf-token": cookies.csrfToken },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().accessToken).toEqual(expect.any(String));
      expect(res.json()).not.toHaveProperty("refreshToken");
      expect(cookieNamed(res, "refreshToken")?.value).not.toBe(cookies.refreshToken);
    });

    test("a rotação também renova o token anti-CSRF", async () => {
      const { cookies } = await loginWithCookies();

      const res = await app.inject({
        method: "POST",
        url: "/sessions/refresh",
        cookies,
        headers: { "x-csrf-token": cookies.csrfToken },
      });

      expect(cookieNamed(res, "csrfToken")?.value).not.toBe(cookies.csrfToken);
    });

    test("cookie sem o header anti-CSRF → 403", async () => {
      const { cookies } = await loginWithCookies();

      const res = await app.inject({ method: "POST", url: "/sessions/refresh", cookies });

      expect(res.statusCode).toBe(403);
    });

    test("cookie com header anti-CSRF divergente → 403", async () => {
      const { cookies } = await loginWithCookies();

      const res = await app.inject({
        method: "POST",
        url: "/sessions/refresh",
        cookies,
        headers: { "x-csrf-token": "valor-que-nao-confere" },
      });

      expect(res.statusCode).toBe(403);
    });

    // A invariante que sustenta o httpOnly: quem apresenta cookie recebe cookie.
    // Sem isso, um XSS pediria o modo corpo e converteria o cookie inalcançável
    // numa string de 30 dias.
    test("cookie não vira token no corpo nem pedindo a entrega por corpo", async () => {
      const { cookies } = await loginWithCookies();

      const res = await app.inject({
        method: "POST",
        url: "/sessions/refresh",
        cookies,
        headers: { "x-csrf-token": cookies.csrfToken, "x-refresh-delivery": "body" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).not.toHaveProperty("refreshToken");
    });

    test("reusar um cookie já rotacionado → 401", async () => {
      const { cookies } = await loginWithCookies();
      await app.inject({
        method: "POST",
        url: "/sessions/refresh",
        cookies,
        headers: { "x-csrf-token": cookies.csrfToken },
      });

      const res = await app.inject({
        method: "POST",
        url: "/sessions/refresh",
        cookies,
        headers: { "x-csrf-token": cookies.csrfToken },
      });

      expect(res.statusCode).toBe(401);
    });

    test("sem cookie e sem corpo → 401", async () => {
      const res = await app.inject({ method: "POST", url: "/sessions/refresh" });

      expect(res.statusCode).toBe(401);
    });

    test("token no corpo continua respondendo pelo corpo, sem exigir anti-CSRF", async () => {
      const login = await app.inject({
        method: "POST",
        url: "/sessions",
        headers: { "x-refresh-delivery": "body" },
        payload: { username, password: PASSWORD },
      });

      const res = await app.inject({
        method: "POST",
        url: "/sessions/refresh",
        payload: { refreshToken: login.json().refreshToken },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().refreshToken).toEqual(expect.any(String));
      expect(res.cookies).toHaveLength(0);
    });
  });

  describe("DELETE /sessions", () => {
    test("revoga pelo cookie e limpa os dois cookies", async () => {
      const { accessToken, cookies } = await loginWithCookies();

      const logout = await app.inject({
        method: "DELETE",
        url: "/sessions",
        cookies,
        headers: { authorization: `Bearer ${accessToken}`, "x-csrf-token": cookies.csrfToken },
      });

      expect(logout.statusCode).toBe(204);
      expect(cookieNamed(logout, "refreshToken")?.value).toBe("");
      expect(cookieNamed(logout, "csrfToken")?.value).toBe("");

      const reuse = await app.inject({
        method: "POST",
        url: "/sessions/refresh",
        cookies,
        headers: { "x-csrf-token": cookies.csrfToken },
      });
      expect(reuse.statusCode).toBe(401);
    });

    test("cookie sem o header anti-CSRF → 403", async () => {
      const { accessToken, cookies } = await loginWithCookies();

      const res = await app.inject({
        method: "DELETE",
        url: "/sessions",
        cookies,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(res.statusCode).toBe(403);
    });

    test("sem cookie e sem corpo → 400", async () => {
      const { accessToken } = await loginWithCookies();

      const res = await app.inject({
        method: "DELETE",
        url: "/sessions",
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
