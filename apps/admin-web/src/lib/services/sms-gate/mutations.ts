'use client';

import {
  CreateSmsCampaignDto,
  ReplySmsConversationDto,
  SendSmsGateMessageDto,
  smsGateApi,
  SmsDeviceFormValues,
  SmsGroupRecipientInput,
  SmsGroupRecipientsResult,
  SmsTemplateFormValues,
} from '@/lib/api/domains/sms-gate';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { smsGateQueryKeys } from './query-keys';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

export const useCreateSmsDevice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: SmsDeviceFormValues) => smsGateApi.createDevice(values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.devices() }),
  });
};
useCreateSmsDevice.permission = ['messaging.device.write'] as const satisfies PermissionRequirement;

export const useUpdateSmsDevice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Omit<SmsDeviceFormValues, 'deviceId'> }) =>
      smsGateApi.updateDevice(id, values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.devices() }),
  });
};
useUpdateSmsDevice.permission = ['messaging.device.write'] as const satisfies PermissionRequirement;

export const useDeleteSmsDevice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => smsGateApi.deleteDevice(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.devices() }),
  });
};
useDeleteSmsDevice.permission = ['messaging.device.write'] as const satisfies PermissionRequirement;

export const useSendSmsGateMessage = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: SendSmsGateMessageDto) => smsGateApi.send(dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.devices() }),
  });
};
useSendSmsGateMessage.permission = ['messaging.message.send'] as const satisfies PermissionRequirement;

export const useCreateSmsTemplate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: SmsTemplateFormValues) => smsGateApi.createTemplate(values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.templates() }),
  });
};
useCreateSmsTemplate.permission = ['messaging.template.write'] as const satisfies PermissionRequirement;

export const useUpdateSmsTemplate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: SmsTemplateFormValues }) =>
      smsGateApi.updateTemplate(id, values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.templates() }),
  });
};
useUpdateSmsTemplate.permission = ['messaging.template.write'] as const satisfies PermissionRequirement;

export const useDeleteSmsTemplate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => smsGateApi.deleteTemplate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.templates() }),
  });
};
useDeleteSmsTemplate.permission = ['messaging.template.write'] as const satisfies PermissionRequirement;

export const usePreviewSmsCampaign = () => {
  return useMutation({
    mutationFn: (dto: Pick<CreateSmsCampaignDto, 'category' | 'sendAt' | 'includeMembers' | 'groupIds'>) =>
      smsGateApi.previewCampaign(dto),
  });
};
usePreviewSmsCampaign.permission = ['messaging.message.read'] as const satisfies PermissionRequirement;

export const useCreateSmsCampaign = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateSmsCampaignDto) => smsGateApi.createCampaign(dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.all }),
  });
};
useCreateSmsCampaign.permission = ['messaging.message.bulk_send'] as const satisfies PermissionRequirement;

// 서버 body 한도(1MB) 아래로 나눠 보낸다.
const GROUP_UPLOAD_BATCH = 2000;

/** groupId 가 없으면 name 으로 새 그룹을 만든 뒤 행을 넣는다. */
export const useUploadSmsGroupRecipients = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      groupId,
      name,
      recipients,
    }: {
      groupId?: string;
      name?: string;
      recipients: SmsGroupRecipientInput[];
    }): Promise<SmsGroupRecipientsResult> => {
      const id = groupId ?? (await smsGateApi.createRecipientGroup(name ?? '')).id;
      const total: SmsGroupRecipientsResult = { groupId: id, received: 0, added: 0, skipped: 0, duplicated: 0 };
      for (let i = 0; i < recipients.length; i += GROUP_UPLOAD_BATCH) {
        const part = await smsGateApi.addGroupRecipients(id, recipients.slice(i, i + GROUP_UPLOAD_BATCH));
        total.received += part.received;
        total.added += part.added;
        total.skipped += part.skipped;
        total.duplicated += part.duplicated;
      }
      return total;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.recipientGroups() }),
  });
};
useUploadSmsGroupRecipients.permission = ['messaging.message.bulk_send'] as const satisfies PermissionRequirement;

export const useImportSupabaseSmsGroup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: { name: string; category: string }) => smsGateApi.importSupabaseGroup(dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.recipientGroups() }),
  });
};
useImportSupabaseSmsGroup.permission = ['messaging.message.bulk_send'] as const satisfies PermissionRequirement;

export const useDeleteSmsRecipientGroup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => smsGateApi.deleteRecipientGroup(groupId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.recipientGroups() }),
  });
};
useDeleteSmsRecipientGroup.permission = ['messaging.message.bulk_send'] as const satisfies PermissionRequirement;

export const useContinueSmsCampaign = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ campaignId, ...dto }: { campaignId: string; name: string; content: string; sendAt?: string }) =>
      smsGateApi.continueCampaign(campaignId, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.all }),
  });
};
useContinueSmsCampaign.permission = ['messaging.message.bulk_send'] as const satisfies PermissionRequirement;

export const useStopSmsCampaign = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (campaignId: string) => smsGateApi.stopCampaign(campaignId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.all }),
  });
};
useStopSmsCampaign.permission = ['messaging.message.bulk_send'] as const satisfies PermissionRequirement;

export const useReplySmsConversation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: ReplySmsConversationDto) => smsGateApi.replyConversation(dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.all }),
  });
};
useReplySmsConversation.permission = ['messaging.message.send'] as const satisfies PermissionRequirement;

export const useDeleteSmsConversation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (phoneNumber: string) => smsGateApi.deleteConversation(phoneNumber),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.all }),
  });
};
useDeleteSmsConversation.permission = ['messaging.message.send'] as const satisfies PermissionRequirement;
