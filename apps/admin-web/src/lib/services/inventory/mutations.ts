// src/lib/services/inventory/mutations.ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryQueryKeys } from './query-keys';
import { inventoryMatchingClient } from '../../api/domains/inventory';
import { stocksClient } from '../../api/domains/inventory/stocks.client';
import { skusClient } from '../../api/domains/inventory/skus.client';
import { warehousesClient } from '../../api/domains/inventory/warehouses.client';
import type {
  AdjustStockDto,
  CreateSkuDto,
  UpdateSkuDto,
  AddBarcodeDto,
  CreateWarehouseDto,
  UpdateWarehouseDto,
} from '../../types/dto/inventory';

export const useAdjustStock = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: AdjustStockDto) => stocksClient.adjustStock(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.stocks });
      queryClient.invalidateQueries({ queryKey: ['stocks', 'summary'] });
    },
  });
};

export const useRebuildStockSummary = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ skuId, warehouseId }: { skuId: string; warehouseId: string }) =>
      stocksClient.rebuildStockSummary(skuId, warehouseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stocks', 'summary'] });
    },
  });
};

export const useCancelStockEvent = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => stocksClient.cancelStockEvent(eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.stocks });
      queryClient.invalidateQueries({ queryKey: ['stocks', 'summary'] });
      queryClient.invalidateQueries({ queryKey: ['stocks', 'history'] });
    },
  });
};

export const useCreateSku = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSkuDto) => skusClient.createSku(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.skus() });
    },
  });
};

export const useUpdateSku = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSkuDto }) =>
      skusClient.updateSku(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.skus() });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.sku(id) });
    },
  });
};

export const useDeleteSku = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => skusClient.deleteSku(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.skus() });
      queryClient.removeQueries({ queryKey: inventoryQueryKeys.sku(id) });
    },
  });
};

export const useAddBarcode = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ skuId, data }: { skuId: string; data: AddBarcodeDto }) =>
      skusClient.addBarcode(skuId, data),
    onSuccess: (_, { skuId }) => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.sku(skuId) });
    },
  });
};

export const useRemoveBarcode = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ skuId, barcodeId }: { skuId: string; barcodeId: string }) =>
      skusClient.removeBarcode(skuId, barcodeId),
    onSuccess: (_, { skuId }) => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.sku(skuId) });
    },
  });
};

export const useCreateWarehouse = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateWarehouseDto) => warehousesClient.createWarehouse(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.warehouses });
    },
  });
};

export const useUpdateWarehouse = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateWarehouseDto }) =>
      warehousesClient.updateWarehouse(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.warehouses });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.warehouse(id) });
    },
  });
};

export const useCreateInventoryMatching = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof inventoryMatchingClient.matchings.create>[0]) =>
      inventoryMatchingClient.matchings.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.inventoryMatchings() });
    },
  });
};

export const useCreateSupplier = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof inventoryMatchingClient.suppliers.create>[0]) =>
      inventoryMatchingClient.suppliers.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.suppliers() });
    },
  });
};

export const useCreateHolder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof inventoryMatchingClient.holders.create>[0]) =>
      inventoryMatchingClient.holders.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.holders() });
    },
  });
};
