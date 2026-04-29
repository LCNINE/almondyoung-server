'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { channels } from '../products/channels.client';
import { channelQueryKeys } from './queries';
import type {
  CreateChannelDto,
  UpdateChannelDto,
  UpdateChannelStatusDto,
} from '@/lib/types/dto/products';

export const useCreateChannel = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateChannelDto) => channels.create(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: channelQueryKeys.all });
    },
  });
};

export const useUpdateChannel = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateChannelDto }) =>
      channels.update(id, data),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: channelQueryKeys.all });
      void queryClient.invalidateQueries({
        queryKey: channelQueryKeys.detail(variables.id),
      });
    },
  });
};

export const useDeleteChannel = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => channels.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: channelQueryKeys.all });
    },
  });
};

export const useUpdateChannelStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateChannelStatusDto }) =>
      channels.updateStatus(id, data),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: channelQueryKeys.all });
      void queryClient.invalidateQueries({
        queryKey: channelQueryKeys.detail(variables.id),
      });
      void queryClient.invalidateQueries({
        queryKey: channelQueryKeys.active(),
      });
    },
  });
};
