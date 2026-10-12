'use client';

import { alimtalkApi } from '@/lib/api/domains/alimtalk';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { alimtalkQueryKeys } from './query-keys';

/** 심사 상태는 NHN 이 정본이라 화면을 열 때마다 새로 묻는다. */
export const useAlimtalkTemplates = (enabled = true) => {
  return useQuery({
    queryKey: alimtalkQueryKeys.templates(),
    queryFn: () => alimtalkApi.getTemplates(),
    staleTime: 0,
    enabled,
  });
};

export const useAlimtalkCategories = () => {
  return useQuery({
    queryKey: alimtalkQueryKeys.categories(),
    queryFn: () => alimtalkApi.getCategories(),
    staleTime: 60 * 60 * 1000,
  });
};

export const useAlimtalkRecipientGroups = () => {
  return useQuery({
    queryKey: alimtalkQueryKeys.recipientGroups(),
    queryFn: () => alimtalkApi.getRecipientGroups(),
  });
};

export const useAlimtalkCampaigns = () => {
  return useQuery({
    queryKey: alimtalkQueryKeys.campaigns(),
    queryFn: () => alimtalkApi.getCampaigns(),
    refetchInterval: 15_000,
  });
};

/** 수신 결과는 NHN 에 묻는 조회라 누를 때만 부른다. */
export const useAlimtalkCampaignResults = (campaignId: string | null) => {
  return useQuery({
    queryKey: alimtalkQueryKeys.campaignResults(campaignId ?? ''),
    queryFn: () => alimtalkApi.getCampaignResults(campaignId ?? ''),
    enabled: campaignId !== null,
    staleTime: 0,
  });
};

/** 자동 알림톡 기록 — 50건씩, 더 보기는 마지막 줄의 시각 이전으로 이어 읽는다. */
export const useAlimtalkAutoSends = (enabled = true) => {
  return useInfiniteQuery({
    queryKey: alimtalkQueryKeys.autoSends(),
    queryFn: ({ pageParam }) => alimtalkApi.getAutoSends(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    enabled,
  });
};

/** 받았는지는 NHN 에 묻는 조회라 누를 때만 부른다. */
export const useAlimtalkAutoSendResult = (notificationId: string | null) => {
  return useQuery({
    queryKey: alimtalkQueryKeys.autoSendResult(notificationId ?? ''),
    queryFn: () => alimtalkApi.getAutoSendResult(notificationId ?? ''),
    enabled: notificationId !== null,
    staleTime: 0,
  });
};

export const useAlimtalkAutoNotices = (enabled = true) => {
  return useQuery({
    queryKey: alimtalkQueryKeys.autoNotices(),
    queryFn: () => alimtalkApi.getAutoNotices(),
    enabled,
  });
};
