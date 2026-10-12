export const alimtalkQueryKeys = {
  all: ['alimtalk'] as const,
  templates: () => [...alimtalkQueryKeys.all, 'templates'] as const,
  categories: () => [...alimtalkQueryKeys.all, 'categories'] as const,
  recipientGroups: () =>
    [...alimtalkQueryKeys.all, 'recipient-groups'] as const,
  campaigns: () => [...alimtalkQueryKeys.all, 'campaigns'] as const,
  campaignResults: (campaignId: string) =>
    [...alimtalkQueryKeys.campaigns(), 'results', campaignId] as const,
  autoSends: () => [...alimtalkQueryKeys.all, 'auto-sends'] as const,
  autoNotices: () => [...alimtalkQueryKeys.all, 'auto-notices'] as const,
  autoSendResult: (notificationId: string) =>
    [...alimtalkQueryKeys.autoSends(), 'result', notificationId] as const,
};
