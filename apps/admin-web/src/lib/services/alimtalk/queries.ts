'use client';

import { alimtalkApi } from '@/lib/api/domains/alimtalk';
import { useQuery } from '@tanstack/react-query';
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
