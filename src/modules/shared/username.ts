import { z } from "zod";

const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

/**
 * Credencial de acesso. Normaliza a caixa antes de validar, para que "Maria" e
 * "maria" sejam a mesma conta e o login não dependa de o usuário acertar a
 * caixa. Todo caminho que grava ou consulta username passa por aqui.
 */
export const usernameSchema = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase())
  .pipe(z.string().min(3).max(30).regex(USERNAME_PATTERN, "Use apenas letras, números, ponto, traço e sublinhado"));
