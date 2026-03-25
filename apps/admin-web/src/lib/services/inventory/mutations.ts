// src/lib/services/inventory/mutations.ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryQueryKeys } from './query-keys';
import { inventoryMatchingClient } from '../../api/domains/inventory';

// 재고 조정 뮤테이션 (임시 구현)
export const useAdjustStock = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: any) =>
      Promise.resolve({ success: true, adjustment: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.stocks });
    },
  });
};

// 재고 요약 재구성 뮤테이션 (임시 구현)
export const useRebuildStockSummary = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => Promise.resolve({ success: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: inventoryQueryKeys.stockSummary,
      });
    },
  });
};

// 재고 이벤트 취소 뮤테이션 (임시 구현)
export const useCancelStockEvent = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (eventId: string) =>
      Promise.resolve({ success: true, eventId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.stocks });
    },
  });
};

// SKU 생성 뮤테이션 (임시 구현)
export const useCreateSku = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: any) => Promise.resolve({ id: 'new-sku-id', ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.skus() });
    },
  });
};

// SKU 수정 뮤테이션 (임시 구현)
export const useUpdateSku = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      Promise.resolve({ id, ...data }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.skus() });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.sku(id) });
    },
  });
};

// SKU 삭제 뮤테이션 (임시 구현)
export const useDeleteSku = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => Promise.resolve(),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.skus() });
      queryClient.removeQueries({ queryKey: inventoryQueryKeys.sku(id) });
    },
  });
};

// 바코드 추가 뮤테이션 (임시 구현)
export const useAddBarcode = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ skuId, barcode }: { skuId: string; barcode: string }) =>
      Promise.resolve({ skuId, barcode }),
    onSuccess: (_, { skuId }) => {
      queryClient.invalidateQueries({
        queryKey: inventoryQueryKeys.sku(skuId),
      });
    },
  });
};

// 바코드 제거 뮤테이션 (임시 구현)
export const useRemoveBarcode = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ skuId, barcode }: { skuId: string; barcode: string }) =>
      Promise.resolve({ skuId, barcode }),
    onSuccess: (_, { skuId }) => {
      queryClient.invalidateQueries({
        queryKey: inventoryQueryKeys.sku(skuId),
      });
    },
  });
};

// 창고 생성 뮤테이션 (임시 구현)
export const useCreateWarehouse = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: any) =>
      Promise.resolve({ id: 'new-warehouse-id', ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: inventoryQueryKeys.warehouses,
      });
    },
  });
};

// 창고 수정 뮤테이션 (임시 구현)
export const useUpdateWarehouse = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      Promise.resolve({ id, ...data }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({
        queryKey: inventoryQueryKeys.warehouses,
      });
      queryClient.invalidateQueries({
        queryKey: inventoryQueryKeys.warehouse(id),
      });
    },
  });
};

// 창고 삭제 뮤테이션 (임시 구현)
// 자동재고매칭 관련 뮤테이션
export const useCreateInventoryMatching = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: any) => inventoryMatchingClient.matchings.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: inventoryQueryKeys.inventoryMatchings(),
      });
    },
  });
};

// 공급처 관련 뮤테이션
export const useCreateSupplier = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: any) => inventoryMatchingClient.suppliers.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: inventoryQueryKeys.suppliers(),
      });
    },
  });
};

// 재고소유 관련 뮤테이션
export const useCreateHolder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: any) => inventoryMatchingClient.holders.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.holders() });
    },
  });
};
