export const rolesQueryKeys = {
  all: ['roles'] as const,
  list: () => [...rolesQueryKeys.all, 'list'] as const,
  detail: (roleId: string) => [...rolesQueryKeys.all, roleId] as const,
} as const;
