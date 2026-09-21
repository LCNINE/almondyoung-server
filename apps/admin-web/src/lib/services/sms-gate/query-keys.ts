export const smsGateQueryKeys = {
  all: ['sms-gate'] as const,
  devices: () => [...smsGateQueryKeys.all, 'devices'] as const,
  audience: () => [...smsGateQueryKeys.all, 'audience'] as const,
  campaigns: () => [...smsGateQueryKeys.all, 'campaigns'] as const,
  conversations: () => [...smsGateQueryKeys.all, 'conversations'] as const,
  conversationList: (q: string) => [...smsGateQueryKeys.conversations(), 'list', q] as const,
  conversation: (phoneNumber: string) => [...smsGateQueryKeys.conversations(), 'detail', phoneNumber] as const,
  templates: () => [...smsGateQueryKeys.all, 'templates'] as const,
  messages: (ids: string[]) => [...smsGateQueryKeys.all, 'messages', ids] as const,
};
