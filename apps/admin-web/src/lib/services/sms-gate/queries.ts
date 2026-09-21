'use client';

import { smsGateApi } from '@/lib/api/domains/sms-gate';
import { useQuery } from '@tanstack/react-query';
import { smsGateQueryKeys } from './query-keys';

const isSettled = (status: string) => status === 'SENT' || status === 'FAILED' || status === 'CANCELLED';

export const useSmsDevices = () => {
  return useQuery({
    queryKey: smsGateQueryKeys.devices(),
    queryFn: () => smsGateApi.getDevices(),
    refetchInterval: 30_000,
  });
};

export const useSmsGateMessages = (ids: string[]) => {
  return useQuery({
    queryKey: smsGateQueryKeys.messages(ids),
    queryFn: () => smsGateApi.getMessages(ids),
    enabled: ids.length > 0,
    refetchInterval: (query) =>
      query.state.data?.every((m) => isSettled(m.status)) ? false : 5_000,
  });
};

export const useSmsTemplates = () => {
  return useQuery({
    queryKey: smsGateQueryKeys.templates(),
    queryFn: () => smsGateApi.getTemplates(),
  });
};
