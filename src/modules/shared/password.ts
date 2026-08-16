import { z } from "zod";

/**
 * Regra única de senha aceitável. Vale para a criação do usuário, para a troca
 * feita pela própria pessoa e para o reset administrativo — três portas que não
 * podem divergir no comprimento mínimo.
 */
export const passwordSchema = z.string().min(8);
