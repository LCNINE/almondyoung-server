'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  medusaRegionsApi,
  type CreateMedusaRegionPayload,
  type UpdateMedusaRegionPayload,
} from '@/lib/api/domains/medusa/regions';

const medusaRegionKeys = {
  all: ['medusa-regions'] as const,
  list: (params: object) => [...medusaRegionKeys.all, 'list', params] as const,
  detail: (id: string) => [...medusaRegionKeys.all, id] as const,
};

export const useMedusaRegions = (
  params: { limit?: number; offset?: number } = {}
) =>
  useQuery({
    queryKey: medusaRegionKeys.list(params),
    queryFn: () => medusaRegionsApi.list(params),
    staleTime: 30_000,
  });

export const useCreateMedusaRegion = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateMedusaRegionPayload) =>
      medusaRegionsApi.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: medusaRegionKeys.all }),
  });
};

export const useUpdateMedusaRegion = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: UpdateMedusaRegionPayload;
    }) => medusaRegionsApi.update(id, payload),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: medusaRegionKeys.all });
      qc.invalidateQueries({ queryKey: medusaRegionKeys.detail(variables.id) });
    },
  });
};

export const useDeleteMedusaRegion = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => medusaRegionsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: medusaRegionKeys.all }),
  });
};
