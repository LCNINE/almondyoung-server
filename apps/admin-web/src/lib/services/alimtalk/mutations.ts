'use client';

import {
  alimtalkApi,
  AlimtalkCampaignTarget,
  AlimtalkTemplateInput,
  CreateAlimtalkCampaignDto,
} from '@/lib/api/domains/alimtalk';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { alimtalkQueryKeys } from './query-keys';

export const useCreateAlimtalkTemplate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      templateCode,
      values,
    }: {
      templateCode: string;
      values: AlimtalkTemplateInput;
    }) => alimtalkApi.createTemplate(templateCode, values),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: alimtalkQueryKeys.templates(),
      }),
  });
};

export const useUpdateAlimtalkTemplate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      templateCode,
      values,
    }: {
      templateCode: string;
      values: AlimtalkTemplateInput & { acknowledgeReReview?: boolean };
    }) => alimtalkApi.updateTemplate(templateCode, values),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: alimtalkQueryKeys.templates(),
      }),
  });
};

export const useAddAlimtalkComment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      templateCode,
      comment,
    }: {
      templateCode: string;
      comment: string;
    }) => alimtalkApi.addComment(templateCode, comment),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: alimtalkQueryKeys.templates(),
      }),
  });
};

export const useAlimtalkTestSend = () => {
  return useMutation({
    mutationFn: ({
      templateCode,
      variables,
    }: {
      templateCode: string;
      variables: { name: string; value: string }[];
    }) => alimtalkApi.testSend(templateCode, variables),
  });
};

export const usePreviewAlimtalkCampaign = () => {
  return useMutation({
    mutationFn: (dto: AlimtalkCampaignTarget) =>
      alimtalkApi.previewCampaign(dto),
  });
};

export const useCreateAlimtalkCampaign = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateAlimtalkCampaignDto) =>
      alimtalkApi.createCampaign(dto),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: alimtalkQueryKeys.campaigns(),
      }),
  });
};

export const useStopAlimtalkCampaign = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (campaignId: string) => alimtalkApi.stopCampaign(campaignId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: alimtalkQueryKeys.campaigns(),
      }),
  });
};
