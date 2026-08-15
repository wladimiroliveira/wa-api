import type { Permission } from "../../generated/prisma/index.js";

export type PermissionSources = {
  rolePermissions: Permission[];
  grantedPermissions: Permission[];
  deniedPermissions: Permission[];
};

/**
 * efetiva = (papel ∪ concedidas) − negadas. Negação sempre ganha.
 * Única fonte da permissão efetiva no projeto.
 */
export function effectivePermissions(sources: PermissionSources): Set<Permission> {
  const effective = new Set<Permission>([...sources.rolePermissions, ...sources.grantedPermissions]);

  for (const denied of sources.deniedPermissions) effective.delete(denied);

  return effective;
}
