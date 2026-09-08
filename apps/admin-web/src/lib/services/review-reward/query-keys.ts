export const reviewRewardQueryKeys = {
  all: ['review-reward'] as const,
  rules: () => [...reviewRewardQueryKeys.all, 'rules'] as const,
  grants: (query: Record<string, unknown>) => [...reviewRewardQueryKeys.all, 'grants', query] as const,
  summary: (days: number) => [...reviewRewardQueryKeys.all, 'summary', days] as const,
  bestSelections: (query: Record<string, unknown>) =>
    [...reviewRewardQueryKeys.all, 'best-selections', query] as const,
} as const;
