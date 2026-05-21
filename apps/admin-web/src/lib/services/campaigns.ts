'use client';

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  medusaCampaignsApi,
  type CreateCampaignPayload,
  type UpdateCampaignPayload,
} from '@/lib/api/domains/medusa/campaigns';
import { couponQueryKeys } from './coupons/query-keys';

const campaignKeys = {
  all: ['campaigns'] as const,
  list: (params: object) => [...campaignKeys.all, 'list', params] as const,
  detail: (id: string) => [...campaignKeys.all, id] as const,
};

export const useCampaignList = (params: { limit?: number; offset?: number; q?: string } = {}) =>
  useQuery({
    queryKey: campaignKeys.list(params),
    queryFn: () => medusaCampaignsApi.list(params),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

export const useGetCampaign = (id: string | null) =>
  useQuery({
    queryKey: campaignKeys.detail(id ?? ''),
    queryFn: () => medusaCampaignsApi.get(id!),
    enabled: !!id,
    staleTime: 30_000,
  });

export const useCreateCampaign = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateCampaignPayload) => medusaCampaignsApi.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: campaignKeys.all }),
  });
};

export const useUpdateCampaign = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateCampaignPayload }) =>
      medusaCampaignsApi.update(id, payload),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: campaignKeys.all });
      qc.invalidateQueries({ queryKey: campaignKeys.detail(variables.id) });
    },
  });
};

export const useDeleteCampaign = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => medusaCampaignsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: campaignKeys.all }),
  });
};

export const useLinkPromotion = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ promotionId, campaignId }: { promotionId: string; campaignId: string }) =>
      medusaCampaignsApi.linkPromotion(promotionId, campaignId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: campaignKeys.all });
      qc.invalidateQueries({ queryKey: couponQueryKeys.all });
    },
  });
};

export const useUnlinkPromotion = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ promotionId }: { promotionId: string; campaignId: string }) =>
      medusaCampaignsApi.unlinkPromotion(promotionId),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: campaignKeys.all });
      qc.invalidateQueries({ queryKey: campaignKeys.detail(variables.campaignId) });
      qc.invalidateQueries({ queryKey: couponQueryKeys.all });
    },
  });
};
