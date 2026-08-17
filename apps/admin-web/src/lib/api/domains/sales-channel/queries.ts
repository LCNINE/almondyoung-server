'use client';

import { useQuery } from '@tanstack/react-query';
import { channelsClient } from '../products/channels.client';
import type { ChannelsQuery } from '@/lib/types/dto/products';

export const channelQueryKeys = {
  all: ['channels'] as const,
  list: (query: Record<string, unknown>) =>
    ['channels', 'list', query] as const,
  detail: (id: string) => ['channels', id] as const,
  active: () => ['channels', 'active'] as const,
};

export const useChannels = (query: ChannelsQuery = {}) =>
  useQuery({
    queryKey: channelQueryKeys.list(query as Record<string, unknown>),
    queryFn: () => channelsClient.getList(query),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

export const useActiveChannels = () =>
  useQuery({
    queryKey: channelQueryKeys.active(),
    queryFn: () => channelsClient.getActive(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

export const useChannel = (id: string) =>
  useQuery({
    queryKey: channelQueryKeys.detail(id),
    queryFn: () => channelsClient.get(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
