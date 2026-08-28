import { z } from "zod";
import { Permission } from "../../generated/prisma/index.js";

export const loginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});

export const sessionTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const messageSchema = z.object({ message: z.string() });

export const currentUserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  username: z.string(),
  roleId: z.uuid().nullable(),
  permissions: z.array(z.enum(Permission)),
});

export const changeOwnPasswordBodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
