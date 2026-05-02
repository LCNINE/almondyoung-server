export const oauthClientsQueryKeys = {
  all: ['oauth-clients'] as const,
  list: () => [...oauthClientsQueryKeys.all, 'list'] as const,
  detail: (clientId: string) => [...oauthClientsQueryKeys.all, clientId] as const,
} as const;
