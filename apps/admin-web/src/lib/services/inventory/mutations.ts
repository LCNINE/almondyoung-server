// src/lib/services/inventory/mutations.ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryQueryKeys } from './query-keys';
import { inventoryMatchingClient } from '../../api/domains/inventory';
import { stocksClient } from '../../api/domains/inventory/stocks.client';
import { skusClient } from '../../api/domains/inventory/skus.client';
import { skuGroupsClient } from '../../api/domains/inventory/sku-groups.client';
import { warehousesClient } from '../../api/domains/inventory/warehouses.client';
import { transfersClient } from '../../api/domains/inventory/transfers.client';
import { reservationsClient } from '../../api/domains/inventory/reservations.client';
import type {
  AdjustStockDto,
  CreateSkuDto,
  UpdateSkuDto,
  AddBarcodeDto,
  CreateWarehouseDto,
  UpdateWarehouseDto,
  CreateSkuGroupDto,
  UpdateSkuGroupDto,
  BulkAddSkusToGroupDto,
  CreateTransferJobDto,
  MoveWithinWarehouseDto,
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

// SKU 그룹 관련 mutations
export const useCreateSkuGroup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSkuGroupDto) => skuGroupsClient.createSkuGroup(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.skuGroups });
    },
  });
};

export const useUpdateSkuGroup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSkuGroupDto }) =>
      skuGroupsClient.updateSkuGroup(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.skuGroups });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.skuGroup(id) });
    },
  });
};

export const useDeleteSkuGroup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => skuGroupsClient.deleteSkuGroup(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.skuGroups });
      queryClient.removeQueries({ queryKey: inventoryQueryKeys.skuGroup(id) });
    },
  });
};

export const useAddSkuToGroup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, skuId }: { groupId: string; skuId: string }) =>
      skuGroupsClient.addSkuToGroup(groupId, { skuId }),
    onSuccess: (_, { groupId }) => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.skuGroups });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.skuGroupMembers(groupId) });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.skus() });
    },
  });
};

export const useBulkAddSkusToGroup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, data }: { groupId: string; data: BulkAddSkusToGroupDto }) =>
      skuGroupsClient.bulkAddSkusToGroup(groupId, data),
    onSuccess: (_, { groupId }) => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.skuGroups });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.skuGroupMembers(groupId) });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.skus() });
    },
  });
};

export const useRemoveSkuFromGroup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ skuId, groupId }: { skuId: string; groupId: string }) =>
      skuGroupsClient.removeSkuFromGroup(skuId),
    onSuccess: (_, { groupId }) => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.skuGroups });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.skuGroupMembers(groupId) });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.skus() });
    },
  });
};

// 재고 이동 관련 mutations
export const useCreateTransferJob = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTransferJobDto) => transfersClient.createTransferJob(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'transfers'] });
    },
  });
};

export const useExecuteTransferJob = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => transfersClient.executeTransferJob(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'transfers'] });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.transferJob(id) });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.transferJobStatus(id) });
    },
  });
};

export const useMoveWithinWarehouse = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: MoveWithinWarehouseDto) => transfersClient.moveWithinWarehouse(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'transfers'] });
      queryClient.invalidateQueries({ queryKey: ['stocks', 'summary'] });
    },
  });
};

// 재고 예약 관련 mutations
export const useReleaseReservation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => reservationsClient.releaseReservation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'reservations'] });
    },
  });
};

export const useExpireStaleReservations = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => reservationsClient.expireStaleReservations(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'reservations'] });
    },
  });
};
