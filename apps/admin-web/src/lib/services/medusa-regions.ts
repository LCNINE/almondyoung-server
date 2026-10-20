'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  medusaRegionsApi,
  type CreateMedusaRegionPayload,
  type UpdateMedusaRegionPayload,
} from '@/lib/api/domains/medusa/regions';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

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
useCreateMedusaRegion.permission = ['system.region.write'] as const satisfies PermissionRequirement;

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
useUpdateMedusaRegion.permission = ['system.region.write'] as const satisfies PermissionRequirement;

export const useDeleteMedusaRegion = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => medusaRegionsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: medusaRegionKeys.all }),
  });
};
useDeleteMedusaRegion.permission = ['system.region.write'] as const satisfies PermissionRequirement;
