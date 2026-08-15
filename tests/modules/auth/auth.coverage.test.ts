import { describe, expect, test } from "vitest";
import fastify from "fastify";
import { registerAuth } from "../../../src/modules/auth/auth.plugin.js";
import { requirePermission } from "../../../src/modules/auth/auth.guard.js";
import { Permission } from "../../../src/generated/prisma/index.js";

describe("cobertura de autorização das rotas", () => {
  test("rota sem declaração de exigência derruba a inicialização", async () => {
    const app = fastify();
    await registerAuth(app);
    // Dentro de um plugin, como no app de verdade: o erro aparece no boot.
    app.register(async (instance) => {
      instance.get("/unguarded", async () => ({ ok: true }));
    });

    await expect(app.ready()).rejects.toThrow(/não declara/);
    await app.close();
  });

  test("rota com requirePermission inicia normalmente", async () => {
    const app = fastify();
    await registerAuth(app);
    app.register(async (instance) => {
      instance.get("/guarded", { preHandler: requirePermission(Permission.SUPPLIES_READ) }, async () => ({ ok: true }));
    });

    await expect(app.ready()).resolves.toBeTruthy();
    await app.close();
  });

  test("rota marcada como pública inicia normalmente", async () => {
    const app = fastify();
    await registerAuth(app);
    app.register(async (instance) => {
      instance.get("/open", { config: { public: true } }, async () => ({ ok: true }));
    });

    await expect(app.ready()).resolves.toBeTruthy();
    await app.close();
  });
});
