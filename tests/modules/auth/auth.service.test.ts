import { afterAll, describe, expect, test } from "vitest";
import prisma from "../../../src/lib/prisma.js";
import { hashPassword } from "../../../src/modules/auth/auth.password.js";
import { hashRefreshToken } from "../../../src/modules/auth/auth.tokens.js";
import {
  authenticate,
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
} from "../../../src/modules/auth/auth.service.js";

const PASSWORD = "senha-de-teste";

describe("auth service (integração)", () => {
  const createdUserIds: string[] = [];

  async function createUser(overrides: { isActive?: boolean } = {}) {
    const user = await prisma.user.create({
      data: {
        name: "Service User",
        username: `service-${crypto.randomUUID().slice(0, 8)}`,
        email: `service-${crypto.randomUUID()}@example.test`,
        passwordHash: await hashPassword(PASSWORD),
        isActive: overrides.isActive ?? true,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  test("autentica com a senha correta", async () => {
    const user = await createUser();

    expect((await authenticate(user.username, PASSWORD)).id).toBe(user.id);
  });

  test("recusa senha errada", async () => {
    const user = await createUser();

    await expect(authenticate(user.username, "errada")).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  test("recusa username inexistente", async () => {
    await expect(authenticate("ninguem", PASSWORD)).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  test("recusa usuário desativado", async () => {
    const user = await createUser({ isActive: false });

    await expect(authenticate(user.username, PASSWORD)).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  test("guarda apenas o hash do refresh token", async () => {
    const user = await createUser();
    const token = await issueRefreshToken(user.id);

    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(token) } });

    expect(stored).not.toBeNull();
    expect(await prisma.refreshToken.count({ where: { tokenHash: token } })).toBe(0);
  });

  test("rotaciona o token e marca o anterior como substituído", async () => {
    const user = await createUser();
    const first = await issueRefreshToken(user.id);

    const rotated = await rotateRefreshToken(first);

    expect(rotated.userId).toBe(user.id);
    expect(rotated.refreshToken).not.toBe(first);

    const previous = await prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(first) } });
    expect(previous?.revokedAt).not.toBeNull();
    expect(previous?.replacedById).not.toBeNull();
  });

  test("reuso de token já rotacionado derruba a sessão inteira", async () => {
    const user = await createUser();
    const first = await issueRefreshToken(user.id);
    const second = (await rotateRefreshToken(first)).refreshToken;

    await expect(rotateRefreshToken(first)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    await expect(rotateRefreshToken(second)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  test("recusa token expirado", async () => {
    const user = await createUser();
    const token = await issueRefreshToken(user.id);

    await prisma.refreshToken.update({
      where: { tokenHash: hashRefreshToken(token) },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    await expect(rotateRefreshToken(token)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  test("recusa token desconhecido", async () => {
    await expect(rotateRefreshToken("token-que-nunca-existiu")).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  test("logout revoga o token e ele não rotaciona mais", async () => {
    const user = await createUser();
    const token = await issueRefreshToken(user.id);

    await revokeRefreshToken(token, user.id);

    await expect(rotateRefreshToken(token)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  test("usuário desativado não consegue mais rotacionar", async () => {
    const user = await createUser();
    const token = await issueRefreshToken(user.id);

    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    await expect(rotateRefreshToken(token)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });
});
