'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  medusaShippingAreaTemplatesApi,
  medusaShippingGroupsApi,
  type ShippingAreaTemplate,
  type ShippingGroupPayload,
} from '@/lib/api/domains/medusa/shipping-groups';

const shippingGroupKeys = {
  all: ['medusa-shipping-groups'] as const,
};

export const useShippingGroups = () =>
  useQuery({
    queryKey: shippingGroupKeys.all,
    queryFn: () => medusaShippingGroupsApi.list(),
    staleTime: 30_000,
  });

export const useCreateShippingGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ShippingGroupPayload) =>
      medusaShippingGroupsApi.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: shippingGroupKeys.all }),
  });
};

export const useUpdateShippingGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      code,
      payload,
    }: {
      code: string;
      payload: Omit<ShippingGroupPayload, 'code'>;
    }) => medusaShippingGroupsApi.update(code, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: shippingGroupKeys.all }),
  });
};

export const useDeleteShippingGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => medusaShippingGroupsApi.delete(code),
    onSuccess: () => qc.invalidateQueries({ queryKey: shippingGroupKeys.all }),
  });
};

const areaTemplateKeys = {
  all: ['medusa-shipping-area-templates'] as const,
};

export const useShippingAreaTemplates = () =>
  useQuery({
    queryKey: areaTemplateKeys.all,
    queryFn: () => medusaShippingAreaTemplatesApi.list(),
    staleTime: 30_000,
  });

export const useUpsertShippingAreaTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ShippingAreaTemplate) =>
      medusaShippingAreaTemplatesApi.upsert(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: areaTemplateKeys.all });
      // 템플릿 금액은 그룹에 복사돼 있어 서버가 그룹을 다시 저장한다. 목록도 갱신.
      qc.invalidateQueries({ queryKey: shippingGroupKeys.all });
    },
  });
};

export const useDeleteShippingAreaTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => medusaShippingAreaTemplatesApi.delete(code),
    onSuccess: () => qc.invalidateQueries({ queryKey: areaTemplateKeys.all }),
  });
};
