'use client';

import {
  SendSmsGateMessageDto,
  smsGateApi,
  SmsDeviceFormValues,
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
