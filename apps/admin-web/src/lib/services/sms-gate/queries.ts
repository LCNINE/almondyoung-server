'use client';

import { smsGateApi } from '@/lib/api/domains/sms-gate';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
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

export const useSmsAudience = () => {
  return useQuery({
    queryKey: smsGateQueryKeys.audience(),
    queryFn: () => smsGateApi.getAudience(),
  });
};

export const useSmsCampaigns = () => {
  return useQuery({
    queryKey: smsGateQueryKeys.campaigns(),
    queryFn: () => smsGateApi.getCampaigns(),
    refetchInterval: 30_000,
  });
};

const CONVERSATION_PAGE_SIZE = 30;

export const useSmsConversations = (q: string) => {
  return useInfiniteQuery({
    queryKey: smsGateQueryKeys.conversationList(q),
    queryFn: ({ pageParam }) =>
      smsGateApi.getConversations({ page: pageParam, limit: CONVERSATION_PAGE_SIZE, q: q || undefined }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
    refetchInterval: 15_000,
  });
};

export const useSmsConversation = (phoneNumber: string | null) => {
  return useQuery({
    queryKey: smsGateQueryKeys.conversation(phoneNumber ?? ''),
    queryFn: () => smsGateApi.getConversation(phoneNumber ?? ''),
    enabled: phoneNumber !== null,
    refetchInterval: 10_000,
  });
};
