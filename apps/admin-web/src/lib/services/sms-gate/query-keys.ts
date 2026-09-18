export const smsGateQueryKeys = {
  all: ['sms-gate'] as const,
  devices: () => [...smsGateQueryKeys.all, 'devices'] as const,
  messages: (ids: string[]) => [...smsGateQueryKeys.all, 'messages', ids] as const,
};
