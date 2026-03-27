// Blacklists 쿼리 키

export const blacklistQueryKeys = {
  all: ['blacklists'] as const,
  byUserId: (userId: string) => ['blacklists', 'user', userId] as const,
};
