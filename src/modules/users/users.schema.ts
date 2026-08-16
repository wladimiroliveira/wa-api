import { z } from "zod";
import { permissionSchema } from "./roles.schema.js";
import { passwordSchema } from "../shared/password.js";
import { usernameSchema } from "../shared/username.js";
import { timestampSchema } from "../shared/response.js";

export const createUserSchema = z.object({
  name: z.string().min(1),
  username: usernameSchema,
  email: z.string().email(),
  password: passwordSchema,
  roleId: z.string().uuid().nullable().optional(),
  grantedPermissions: z.array(permissionSchema).default([]),
  deniedPermissions: z.array(permissionSchema).default([]),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  // Editável: sem DELETE /users/:id, um username errado seria impossível de consertar.
  username: usernameSchema.optional(),
  roleId: z.string().uuid().nullable().optional(),
  grantedPermissions: z.array(permissionSchema).optional(),
  deniedPermissions: z.array(permissionSchema).optional(),
  isActive: z.boolean().optional(),
});

/** Reset administrativo: sem senha atual, porque quem administra não a conhece. */
export const resetPasswordSchema = z.object({
  newPassword: passwordSchema,
});

export const userIdParamSchema = z.object({ id: z.string().uuid() });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Espelha os publicFields do repositório: tudo menos o hash da senha. */
export const userResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  username: z.string(),
  email: z.string().email(),
  roleId: z.string().uuid().nullable(),
  grantedPermissions: z.array(permissionSchema),
  deniedPermissions: z.array(permissionSchema),
  isActive: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const userListResponseSchema = z.array(userResponseSchema);

export const userPermissionsResponseSchema = z.object({
  userId: z.string().uuid(),
  permissions: z.array(permissionSchema),
});
