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
  byType: (type: string) => ['channels', 'type', type] as const,
  sites: (type: string) => ['sales-channel-sites', type] as const,
};

export const SALES_CHANNEL_SITES = [
  { id: 'medusa', type: 'medusa', name: '아몬드영 (자사몰)', isActive: true },
  {
    id: 'naver_smartstore',
    type: 'naver_smartstore',
    name: '네이버 스마트스토어',
    isActive: true,
  },
  { id: 'coupang', type: 'coupang', name: '쿠팡', isActive: true },
  { id: 'phone_order', type: 'phone_order', name: '전화주문', isActive: true },
  { id: 'other', type: 'other', name: '기타', isActive: true },
] as const;

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

export const useChannelsByType = (type: string) =>
  useQuery({
    queryKey: channelQueryKeys.byType(type),
    queryFn: () => channelsClient.getByType(type),
    enabled: !!type,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

export const useSalesChannelSites = (type: string = 'all') =>
  useQuery({
    queryKey: channelQueryKeys.sites(type),
    queryFn: () =>
      type === 'all'
        ? [...SALES_CHANNEL_SITES]
        : SALES_CHANNEL_SITES.filter((s) => s.type === type),
    staleTime: Infinity,
    gcTime: Infinity,
  });
