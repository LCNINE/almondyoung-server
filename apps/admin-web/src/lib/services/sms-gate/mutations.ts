'use client';

import {
  CreateSmsCampaignDto,
  ReplySmsConversationDto,
  SendSmsGateMessageDto,
  smsGateApi,
  SmsDeviceFormValues,
  SmsTemplateFormValues,
} from '@/lib/api/domains/sms-gate';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { smsGateQueryKeys } from './query-keys';

export const useCreateSmsDevice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: SmsDeviceFormValues) => smsGateApi.createDevice(values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.devices() }),
  });
};

export const useUpdateSmsDevice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Omit<SmsDeviceFormValues, 'deviceId'> }) =>
      smsGateApi.updateDevice(id, values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.devices() }),
  });
};

export const useDeleteSmsDevice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => smsGateApi.deleteDevice(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.devices() }),
  });
};

export const useSendSmsGateMessage = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: SendSmsGateMessageDto) => smsGateApi.send(dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.devices() }),
  });
};

export const useCreateSmsTemplate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: SmsTemplateFormValues) => smsGateApi.createTemplate(values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.templates() }),
  });
};

export const useUpdateSmsTemplate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: SmsTemplateFormValues }) =>
      smsGateApi.updateTemplate(id, values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.templates() }),
  });
};

export const useDeleteSmsTemplate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => smsGateApi.deleteTemplate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.templates() }),
  });
};

export const usePreviewSmsCampaign = () => {
  return useMutation({
    mutationFn: (dto: Pick<CreateSmsCampaignDto, 'category' | 'sendAt'>) => smsGateApi.previewCampaign(dto),
  });
};

export const useCreateSmsCampaign = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateSmsCampaignDto) => smsGateApi.createCampaign(dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.all }),
  });
};

export const useStopSmsCampaign = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (campaignId: string) => smsGateApi.stopCampaign(campaignId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.all }),
  });
};

export const useReplySmsConversation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: ReplySmsConversationDto) => smsGateApi.replyConversation(dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.all }),
  });
};

export const useDeleteSmsConversation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (phoneNumber: string) => smsGateApi.deleteConversation(phoneNumber),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsGateQueryKeys.all }),
  });
};
