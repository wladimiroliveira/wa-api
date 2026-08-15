import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/server.js";
import prisma from "../../../src/lib/prisma.js";
import { createActor, deleteActor, type TestActor } from "../../helpers/auth.js";
import { Permission } from "../../../src/generated/prisma/index.js";

describe("roles routes (integração)", () => {
  let app: FastifyInstance;
  let admin: TestActor;
  let reader: TestActor;
  const createdRoleIds: string[] = [];

  async function createRole(name: string, permissions: Permission[] = [Permission.STOCK_READ]) {
    const res = await app.inject({
      method: "POST",
      url: "/roles",
      headers: admin.headers,
      payload: { name, permissions },
    });
    if (res.statusCode === 201) createdRoleIds.push(res.json().id);
    return res;
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    admin = await createActor(app, [Permission.USERS_READ, Permission.USERS_WRITE]);
    reader = await createActor(app, [Permission.USERS_READ]);
  });

  afterAll(async () => {
    await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
    await deleteActor(admin.userId);
    await deleteActor(reader.userId);
    await app.close();
  });

  test("cria papel com 201", async () => {
    const res = await createRole(`Stock Keeper ${crypto.randomUUID()}`);

    expect(res.statusCode).toBe(201);
    expect(res.json().permissions).toEqual([Permission.STOCK_READ]);
  });

  test("recusa permissão que não existe no enum", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/roles",
      headers: admin.headers,
      payload: { name: "Inválido", permissions: ["STOCK_DESTROY"] },
    });

    expect(res.statusCode).toBe(400);
  });

  test("recusa nome duplicado com 409", async () => {
    const name = `Duplicado ${crypto.randomUUID()}`;
    await createRole(name);

    expect((await createRole(name)).statusCode).toBe(409);
  });

  test("lista traz o papel criado", async () => {
    const created = await createRole(`Listado ${crypto.randomUUID()}`);

    const res = await app.inject({ method: "GET", url: "/roles", headers: admin.headers });

    expect(res.statusCode).toBe(200);
    expect(res.json().map((role: { id: string }) => role.id)).toContain(created.json().id);
  });

  test("edita o pacote de permissões", async () => {
    const created = await createRole(`Editado ${crypto.randomUUID()}`);

    const res = await app.inject({
      method: "PATCH",
      url: `/roles/${created.json().id}`,
      headers: admin.headers,
      payload: { permissions: [Permission.STOCK_READ, Permission.STOCK_WRITE] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().permissions.sort()).toEqual([Permission.STOCK_READ, Permission.STOCK_WRITE].sort());
  });

  test("remove papel e deixa o usuário sem herança", async () => {
    const created = await createRole(`Removido ${crypto.randomUUID()}`);
    const roleId = created.json().id;
    const orphan = await createActor(app, []);
    await prisma.user.update({ where: { id: orphan.userId }, data: { roleId } });

    const res = await app.inject({ method: "DELETE", url: `/roles/${roleId}`, headers: admin.headers });

    expect(res.statusCode).toBe(204);
    expect((await prisma.user.findUnique({ where: { id: orphan.userId } }))?.roleId).toBeNull();

    await deleteActor(orphan.userId);
  });

  test("quem só tem USERS_READ não escreve", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/roles",
      headers: reader.headers,
      payload: { name: "Negado", permissions: [] },
    });

    expect(res.statusCode).toBe(403);
  });

  test("quem não tem USERS_READ não lista", async () => {
    const outsider = await createActor(app, [Permission.STOCK_READ]);

    const res = await app.inject({ method: "GET", url: "/roles", headers: outsider.headers });

    expect(res.statusCode).toBe(403);
    await deleteActor(outsider.userId);
  });
});
