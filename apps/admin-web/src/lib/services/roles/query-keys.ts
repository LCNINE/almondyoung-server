export const rolesQueryKeys = {
  all: ['roles'] as const,
  list: () => [...rolesQueryKeys.all, 'list'] as const,
  detail: (roleId: string) => [...rolesQueryKeys.all, roleId] as const,
  members: (roleId: string) =>
    [...rolesQueryKeys.all, roleId, 'members'] as const,
} as const;
