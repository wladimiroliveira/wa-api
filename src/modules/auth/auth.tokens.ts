import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

export function generateRefreshToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * O refresh token já é 32 bytes aleatórios: não há dicionário a atacar,
 * então sha256 basta. KDF lento fica só para senha escolhida por gente.
 */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
