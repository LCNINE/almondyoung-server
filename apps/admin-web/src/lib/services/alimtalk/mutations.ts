'use client';

import {
  alimtalkApi,
  AlimtalkCampaignTarget,
  AlimtalkTemplateInput,
  CreateAlimtalkCampaignDto,
} from '@/lib/api/domains/alimtalk';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationAdminApi } from '@/lib/api/domains/notification';
import { alimtalkQueryKeys } from './query-keys';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

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
useCreateAlimtalkTemplate.permission = ['messaging.template.write'] as const satisfies PermissionRequirement;

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
useUpdateAlimtalkTemplate.permission = ['messaging.template.write'] as const satisfies PermissionRequirement;

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
useAddAlimtalkComment.permission = ['messaging.template.write'] as const satisfies PermissionRequirement;

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
useAlimtalkTestSend.permission = ['messaging.message.send'] as const satisfies PermissionRequirement;

export const usePreviewAlimtalkCampaign = () => {
  return useMutation({
    mutationFn: (dto: AlimtalkCampaignTarget) =>
      alimtalkApi.previewCampaign(dto),
  });
};
usePreviewAlimtalkCampaign.permission = ['messaging.message.read'] as const satisfies PermissionRequirement;

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
useCreateAlimtalkCampaign.permission = ['messaging.message.bulk_send'] as const satisfies PermissionRequirement;

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
useStopAlimtalkCampaign.permission = ['messaging.message.bulk_send'] as const satisfies PermissionRequirement;

/** 연결이 바뀌면 템플릿 목록의 «쓰는 자동 알림»과 메시지 관리의 설정도 바뀐다. */
function useInvalidateAutoNotices() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: alimtalkQueryKeys.autoNotices() }),
      queryClient.invalidateQueries({ queryKey: alimtalkQueryKeys.templates() }),
      queryClient.invalidateQueries({ queryKey: ['notification'] }),
    ]);
}

export const useLinkAlimtalkAutoNotice = () => {
  const invalidate = useInvalidateAutoNotices();
  return useMutation({
    mutationFn: ({
      eventKey,
      templateCode,
      replaceActive,
    }: {
      eventKey: string;
      templateCode: string;
      replaceActive?: boolean;
    }) => alimtalkApi.linkAutoNotice(eventKey, templateCode, replaceActive),
    onSuccess: invalidate,
  });
};
useLinkAlimtalkAutoNotice.permission = ['messaging.template.write'] as const satisfies PermissionRequirement;

export const useUnlinkAlimtalkAutoNotice = () => {
  const invalidate = useInvalidateAutoNotices();
  return useMutation({
    mutationFn: (eventKey: string) => alimtalkApi.unlinkAutoNotice(eventKey),
    onSuccess: invalidate,
  });
};
useUnlinkAlimtalkAutoNotice.permission = ['messaging.template.write'] as const satisfies PermissionRequirement;

/** 자동 알림 켜고 끄기 — 메시지 관리와 같은 이벤트 설정을 바꾼다. */
export const useToggleAlimtalkAutoNotice = () => {
  const invalidate = useInvalidateAutoNotices();
  return useMutation({
    mutationFn: ({ eventKey, isActive }: { eventKey: string; isActive: boolean }) =>
      notificationAdminApi.updateEvent(eventKey, { isActive }),
    onSuccess: invalidate,
  });
};
useToggleAlimtalkAutoNotice.permission = ['messaging.template.write'] as const satisfies PermissionRequirement;
