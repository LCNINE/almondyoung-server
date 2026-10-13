// src/lib/services/inventory/mutations.ts
'use client';

import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryQueryKeys } from './query-keys';
import {
  inboundOperationInvalidationKeys,
  lineExecutionInvalidationKeys,
} from './line-execution-invalidation';
import { isCustomError } from '../../api/customError';
import { stocksClient } from '../../api/domains/inventory/stocks.client';
import { skusClient } from '../../api/domains/inventory/skus.client';
import { skuGroupsClient } from '../../api/domains/inventory/sku-groups.client';
import { warehousesClient } from '../../api/domains/inventory/warehouses.client';
import { deliveryProfilesClient } from '../../api/domains/inventory/delivery-profiles.client';
import { reservationsClient } from '../../api/domains/inventory/reservations.client';
import { stocktakingClient } from '../../api/domains/inventory/stocktaking.client';
import { suppliersClient } from '../../api/domains/inventory/suppliers.client';
import { supplierCategoriesClient } from '../../api/domains/inventory/supplier-categories.client';
import { holdersClient } from '../../api/domains/inventory/holders.client';
import { locationsClient } from '../../api/domains/inventory/locations.client';
import { purchaseOrdersClient } from '../../api/domains/inventory/purchase-orders.client';
import { inboundClient } from '../../api/domains/inventory/inbound.client';
import { returnsClient } from '../../api/domains/inventory/returns.client';
import { movementClient } from '../../api/domains/inventory/movement.client';
import { warehouseTransfersClient } from '../../api/domains/inventory/warehouse-transfers.client';
import { replenishmentClient } from '../../api/domains/inventory/replenishment.client';
import type {
  AdjustStockDto,
  CreateSkuDto,
  UpdateSkuDto,
  AddBarcodeDto,
  CreateWarehouseDto,
  UpdateWarehouseDto,
  CreateDeliveryProfileDto,
  UpdateDeliveryProfileDto,
  CreateSkuGroupDto,
  UpdateSkuGroupDto,
  BulkAddSkusToGroupDto,
  CreateStocktakingSessionRequest,
  ScanLocationRequest,
  ScanProductRequest,
  UpdateLineCountRequest,
  GenerateAdjustmentsRequest,
  CreateSupplierRequest,
  UpdateSupplierRequest,
  CreateSupplierCategoryRequest,
  UpdateSupplierCategoryRequest,
  CreateHolderRequest,
  UpdateHolderRequest,
  CreateColumnRequest,
  UpdateColumnRequest,
  CreateRackRequest,
  UpdateRackRequest,
  CreateZoneLocationRequest,
  UpdateLocationRequest,
  AddCustomBinRequest,
  CreatePurchaseOrderRequest,
  UpdatePurchaseOrderLinesRequest,
  OrderPurchaseOrderLineRequest,
  MarkLineUnavailableRequest,
  CancelPurchaseOrderRequest,
  AddToCartRequest,
  UpdateCartItemRequest,
  CreatePurchaseOrderFromCartRequest,
  SimpleInboundDto,
  IndividualInboundDto,
  VerifyBarcodeRequest,
  PutawayRequestDto,
  ReturnInboundDto,
  CancelInboundDto,
  UpdateInboundLineMemoDto,
  ReceivePurchaseOrderRequest,
  CancelPurchaseOrderReceiptLineRequest,
  ShortClosePurchaseOrderLineRequest,
  UpdatePurchaseOrderLineExpectedArrivalRequest,
  CreateReturnDto,
  ReceiveReturnDto,
  InspectReturnDto,
  ProcessReturnDto,
  MoveBatchRequestDto,
  CreateTransferOrderRequest,
  UpdateReplenishmentSettingsDto,
  GradeRuleDto,
  UpsertLeadTimeRuleDto,
  UpsertSkuOverrideDto,
} from '../../types/dto/inventory';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

/**
 * 멱등 키 수명주기를 관리하는 mutation 래퍼 (P2-4, 스펙 §5).
 * - 키를 ref 로 유지: 네트워크 오류 후 재클릭이 같은 키 재사용 → 서버 replay
 *   (전역 mutation 기본값이 retry:false 라 자동 재시도는 없다 — #963)
 * - 성공 시 키 교체(다음 제출은 새 작업), 4xx 시 교체(서버 미커밋 확정)
 * - 네트워크/타임아웃/5xx 는 키 유지: 서버가 커밋했을 수 있으므로 재시도가 replay 돼야 함
 */
function useIdempotentMutation<TVars, TData>(opts: {
  mutationFn: (vars: TVars, idempotencyKey: string) => Promise<TData>;
  onSuccess?: (data: TData, vars: TVars) => void;
  onSettled?: (data: TData | undefined, error: Error | null, vars: TVars) => void;
}) {
  const keyRef = useRef<string>(crypto.randomUUID());
  return useMutation({
    mutationFn: (vars: TVars) => opts.mutationFn(vars, keyRef.current),
    onSuccess: (data, vars) => {
      keyRef.current = crypto.randomUUID();
      opts.onSuccess?.(data, vars);
    },
    onError: (error) => {
      if (isCustomError(error) && error.statusCode < 500) {
        keyRef.current = crypto.randomUUID();
      }
    },
    onSettled: (data, error, vars) => opts.onSettled?.(data, error, vars),
  });
}

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
useAdjustStock.permission = ['inventory.stock.adjust'] as const satisfies PermissionRequirement;

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
useRebuildStockSummary.permission = ['inventory.stock.adjust'] as const satisfies PermissionRequirement;

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
useCancelStockEvent.permission = ['inventory.stock.adjust'] as const satisfies PermissionRequirement;

export const useCreateSku = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSkuDto) => skusClient.createSku(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.skus() });
    },
  });
};
useCreateSku.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

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
useUpdateSku.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

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
useDeleteSku.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

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
useAddBarcode.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

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
useRemoveBarcode.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useCreateWarehouse = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateWarehouseDto) => warehousesClient.createWarehouse(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.warehouses });
    },
  });
};
useCreateWarehouse.permission = ['inventory.warehouse.write'] as const satisfies PermissionRequirement;

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
useUpdateWarehouse.permission = ['inventory.warehouse.write'] as const satisfies PermissionRequirement;

export const useCreateDeliveryProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateDeliveryProfileDto) => deliveryProfilesClient.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.deliveryProfiles }),
  });
};
useCreateDeliveryProfile.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useUpdateDeliveryProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateDeliveryProfileDto }) =>
      deliveryProfilesClient.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.deliveryProfiles }),
  });
};
useUpdateDeliveryProfile.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useCreateSupplier = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSupplierRequest) => suppliersClient.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.suppliers() });
    },
  });
};
useCreateSupplier.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useUpdateSupplier = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSupplierRequest }) =>
      suppliersClient.update(id, data),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.suppliers() });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.supplier(id) });
    },
  });
};
useUpdateSupplier.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useDeleteSupplier = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => suppliersClient.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.suppliers() });
    },
  });
};
useDeleteSupplier.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useCreateSupplierCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSupplierCategoryRequest) => supplierCategoriesClient.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.supplierCategories() });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.supplierFilterOptions() });
    },
  });
};
useCreateSupplierCategory.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useUpdateSupplierCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSupplierCategoryRequest }) =>
      supplierCategoriesClient.update(id, data),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.supplierCategories() });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.supplierCategory(id) });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.supplierFilterOptions() });
    },
  });
};
useUpdateSupplierCategory.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useDeleteSupplierCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => supplierCategoriesClient.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.supplierCategories() });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.supplierFilterOptions() });
    },
  });
};
useDeleteSupplierCategory.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useCreateHolder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateHolderRequest) => holdersClient.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.holders() });
    },
  });
};
useCreateHolder.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useUpdateHolder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateHolderRequest }) =>
      holdersClient.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.holders() });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.holder(id) });
    },
  });
};
useUpdateHolder.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useDeleteHolder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => holdersClient.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.holders() });
      queryClient.removeQueries({ queryKey: inventoryQueryKeys.holder(id) });
    },
  });
};
useDeleteHolder.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

// 로케이션 관련 mutations
export const useCreateColumn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ warehouseId, data }: { warehouseId: string; data: CreateColumnRequest }) =>
      locationsClient.columns.create(warehouseId, data),
    onSuccess: (_, { warehouseId }) => {
      queryClient.invalidateQueries({ queryKey: ['locations', warehouseId] });
    },
  });
};
useCreateColumn.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useUpdateColumn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ columnId, data }: { columnId: string; data: UpdateColumnRequest }) =>
      locationsClient.columns.update(columnId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] });
    },
  });
};
useUpdateColumn.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useCreateRack = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ warehouseId, data }: { warehouseId: string; data: CreateRackRequest }) =>
      locationsClient.racks.create(warehouseId, data),
    onSuccess: (_, { warehouseId }) => {
      queryClient.invalidateQueries({ queryKey: ['locations', warehouseId] });
    },
  });
};
useCreateRack.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useUpdateRack = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rackId, data }: { rackId: string; data: UpdateRackRequest }) =>
      locationsClient.racks.update(rackId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] });
    },
  });
};
useUpdateRack.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useCreateZoneLocation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ warehouseId, data }: { warehouseId: string; data: CreateZoneLocationRequest }) =>
      locationsClient.zones.create(warehouseId, data),
    onSuccess: (_, { warehouseId }) => {
      queryClient.invalidateQueries({ queryKey: ['locations', warehouseId] });
    },
  });
};
useCreateZoneLocation.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useUpdateLocation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateLocationRequest }) =>
      locationsClient.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.location(id) });
    },
  });
};
useUpdateLocation.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useAddCustomBin = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ warehouseId, data }: { warehouseId: string; data: AddCustomBinRequest }) =>
      locationsClient.customBins.add(warehouseId, data),
    onSuccess: (_, { warehouseId }) => {
      queryClient.invalidateQueries({ queryKey: ['locations', warehouseId] });
    },
  });
};
useAddCustomBin.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

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
useCreateSkuGroup.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

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
useUpdateSkuGroup.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

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
useDeleteSkuGroup.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

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
useAddSkuToGroup.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

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
useBulkAddSkusToGroup.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

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
useRemoveSkuFromGroup.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

// 재고 실사 관련 mutations
export const useCreateStocktakingSession = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateStocktakingSessionRequest) =>
      stocktakingClient.createSession(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'stocktaking', 'sessions'] });
    },
  });
};
useCreateStocktakingSession.permission = ['inventory.stock.operate'] as const satisfies PermissionRequirement;

export const useStartStocktakingSession = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => stocktakingClient.startSession(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'stocktaking', 'sessions'] });
      queryClient.invalidateQueries({
        queryKey: inventoryQueryKeys.stocktakingSession(id),
      });
    },
  });
};
useStartStocktakingSession.permission = ['inventory.stock.operate'] as const satisfies PermissionRequirement;

export const useScanLocation = () => {
  return useMutation({
    mutationFn: (data: ScanLocationRequest) => stocktakingClient.scanLocation(data),
  });
};
useScanLocation.permission = ['inventory.stock.operate'] as const satisfies PermissionRequirement;

export const useScanProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ScanProductRequest) => stocktakingClient.scanProduct(data),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({
        queryKey: inventoryQueryKeys.stocktakingVariances(vars.sessionId),
      });
    },
  });
};
useScanProduct.permission = ['inventory.stock.operate'] as const satisfies PermissionRequirement;

export const useUpdateLineCount = () => {
  return useMutation({
    mutationFn: ({ lineId, data }: { lineId: string; data: UpdateLineCountRequest }) =>
      stocktakingClient.updateLineCount(lineId, data),
  });
};
useUpdateLineCount.permission = ['inventory.stock.operate'] as const satisfies PermissionRequirement;

export const useGenerateAdjustments = () => {
  return useMutation({
    mutationFn: ({ sessionId, data }: { sessionId: string; data?: GenerateAdjustmentsRequest }) =>
      stocktakingClient.generateAdjustments(sessionId, data),
  });
};
useGenerateAdjustments.permission = ['inventory.stock.operate'] as const satisfies PermissionRequirement;

export const useCompleteStocktakingSession = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, data }: { sessionId: string; data: { idempotencyKey: string; previewToken: string } }) => stocktakingClient.completeSession(sessionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'stocktaking', 'sessions'] });
    },
  });
};
useCompleteStocktakingSession.permission = ['inventory.stock.adjust'] as const satisfies PermissionRequirement;

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
useReleaseReservation.permission = ['inventory.stock.adjust'] as const satisfies PermissionRequirement;

export const useReconcileReservations = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => reservationsClient.reconcileReservations(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'reservations'] });
    },
  });
};
useReconcileReservations.permission = ['inventory.stock.adjust'] as const satisfies PermissionRequirement;

// 발주 관련 뮤테이션
export const useCreatePurchaseOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreatePurchaseOrderRequest) => purchaseOrdersClient.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.purchaseOrdersRoot });
    },
  });
};
useCreatePurchaseOrder.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useCreatePurchaseOrderFromCart = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreatePurchaseOrderFromCartRequest) =>
      purchaseOrdersClient.createFromCart(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.purchaseOrdersRoot });
      // purchaseOrdersRoot 가 이미 cart 쿼리도 덮지만, 의도를 남기려고 남겨둔다.
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.purchaseOrderCart() });
    },
  });
};
useCreatePurchaseOrderFromCart.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useUpdatePurchaseOrderLines = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePurchaseOrderLinesRequest }) =>
      purchaseOrdersClient.updateLines(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.purchaseOrdersRoot });
    },
  });
};
useUpdatePurchaseOrderLines.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useOrderPurchaseOrderLine = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      poId,
      skuId,
      data,
    }: {
      poId: string;
      skuId: string;
      data: OrderPurchaseOrderLineRequest;
    }) => purchaseOrdersClient.orderLine(poId, skuId, data),
    // onSettled — 실패(특히 409)에도 무효화한다. 이미 남이 실행한 라인을 409 로
    // 되돌려받았을 때 목록이 여전히 requested+버튼을 보여주면 무한 재시도가
    // 가능해진다. 서버는 커밋됐는데 응답만 유실된 요청(타임아웃·5xx)도 실패로
    // 끝나므로, 그때 옛 화면을 남기지 않으려면 역시 무효화가 필요하다.
    onSettled: (_res, _err, { poId }) => {
      for (const queryKey of lineExecutionInvalidationKeys(poId)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};
useOrderPurchaseOrderLine.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useMarkPurchaseOrderLineUnavailable = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      poId,
      skuId,
      data,
    }: {
      poId: string;
      skuId: string;
      data: MarkLineUnavailableRequest;
    }) => purchaseOrdersClient.markLineUnavailable(poId, skuId, data),
    // onSettled — 실패(특히 409)에도 무효화한다. 이미 남이 실행한 라인을 409 로
    // 되돌려받았을 때 목록이 여전히 requested+버튼을 보여주면 무한 재시도가
    // 가능해진다. 서버는 커밋됐는데 응답만 유실된 요청(타임아웃·5xx)도 실패로
    // 끝나므로, 그때 옛 화면을 남기지 않으려면 역시 무효화가 필요하다.
    onSettled: (_res, _err, { poId }) => {
      for (const queryKey of lineExecutionInvalidationKeys(poId)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};
useMarkPurchaseOrderLineUnavailable.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useCancelPurchaseOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      poId,
      data,
    }: {
      poId: string;
      data: CancelPurchaseOrderRequest;
    }) => purchaseOrdersClient.cancel(poId, data),
    onSettled: (_res, _err, { poId }) => {
      for (const queryKey of lineExecutionInvalidationKeys(poId)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};
useCancelPurchaseOrder.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useReceivePurchaseOrder = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: ({ poId, ...data }: ReceivePurchaseOrderRequest & { poId: string }, idempotencyKey) =>
      purchaseOrdersClient.receive(poId, { ...data, idempotencyKey }),
    onSettled: (_res, _err, { poId }) => {
      for (const queryKey of lineExecutionInvalidationKeys(poId)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};
useReceivePurchaseOrder.permission = ['inventory.stock.operate'] as const satisfies PermissionRequirement;

export const useCancelPurchaseOrderReceiptLine = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: CancelPurchaseOrderReceiptLineRequest, idempotencyKey) =>
      purchaseOrdersClient.cancelReceiptLine({ ...data, idempotencyKey }),
    onSettled: (_res, _err, { receiptLineId }) => {
      for (const queryKey of lineExecutionInvalidationKeys(receiptLineId)) queryClient.invalidateQueries({ queryKey });
    },
  });
};
useCancelPurchaseOrderReceiptLine.permission = ['inventory.stock.operate'] as const satisfies PermissionRequirement;

export const useShortClosePurchaseOrderLine = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, skuId, data }: { poId: string; skuId: string; data: ShortClosePurchaseOrderLineRequest }) =>
      purchaseOrdersClient.shortCloseLine(poId, skuId, data),
    onSettled: (_res, _err, { poId }) => {
      for (const queryKey of lineExecutionInvalidationKeys(poId)) queryClient.invalidateQueries({ queryKey });
    },
  });
};
useShortClosePurchaseOrderLine.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useUpdatePurchaseOrderLineExpectedArrival = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, skuId, data }: { poId: string; skuId: string; data: UpdatePurchaseOrderLineExpectedArrivalRequest }) =>
      purchaseOrdersClient.updateLineExpectedArrival(poId, skuId, data),
    onSettled: (_res, _err, { poId }) => {
      for (const queryKey of lineExecutionInvalidationKeys(poId)) queryClient.invalidateQueries({ queryKey });
    },
  });
};
useUpdatePurchaseOrderLineExpectedArrival.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useAddToCart = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: AddToCartRequest) => purchaseOrdersClient.cart.add(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.purchaseOrderCart() });
      // 카트에 담겨도 원장은 안 변하므로 제안이 사라지진 않지만, 목록의 신선도 기대를 맞춘다.
      queryClient.invalidateQueries({ queryKey: ['replenishment'] });
    },
  });
};
useAddToCart.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useCreateTransferOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTransferOrderRequest) => warehouseTransfersClient.create(data),
    onSuccess: () => {
      // 초안이 생기면 이동가능이 줄어 제안이 바뀐다.
      queryClient.invalidateQueries({ queryKey: ['replenishment'] });
    },
  });
};
useCreateTransferOrder.permission = ['inventory.stock.adjust'] as const satisfies PermissionRequirement;

export const useUpdateCartItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, data }: { itemId: string; data: UpdateCartItemRequest }) =>
      purchaseOrdersClient.cart.update(itemId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.purchaseOrderCart() });
    },
  });
};
useUpdateCartItem.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useRemoveCartItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => purchaseOrdersClient.cart.remove(itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.purchaseOrderCart() });
    },
  });
};
useRemoveCartItem.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useClearCart = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (type?: string) => purchaseOrdersClient.cart.clear(type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.purchaseOrderCart() });
    },
  });
};
useClearCart.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

// 입고 관련 뮤테이션
export const useSimpleInbound = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: SimpleInboundDto, idempotencyKey) => inboundClient.simple({ ...data, idempotencyKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.inbounds });
    },
  });
};
useSimpleInbound.permission = ['inventory.stock.operate'] as const satisfies PermissionRequirement;

export const useSimpleFullscanInbound = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: SimpleInboundDto, idempotencyKey) => inboundClient.simpleFullscan({ ...data, idempotencyKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.inbounds });
    },
  });
};
useSimpleFullscanInbound.permission = ['inventory.stock.operate'] as const satisfies PermissionRequirement;

export const useIndividualInbound = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: IndividualInboundDto, idempotencyKey) => inboundClient.individual({ ...data, idempotencyKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.inbounds });
    },
  });
};
useIndividualInbound.permission = ['inventory.stock.operate'] as const satisfies PermissionRequirement;

export const useVerifyBarcode = () => {
  return useMutation({
    mutationFn: (data: VerifyBarcodeRequest) => inboundClient.verifyBarcode(data),
  });
};
useVerifyBarcode.permission = ['inventory.stock.operate'] as const satisfies PermissionRequirement;

export const usePutaway = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: PutawayRequestDto, idempotencyKey) => inboundClient.putaway({ ...data, idempotencyKey }),
    onSuccess: () => {
      for (const queryKey of inboundOperationInvalidationKeys()) queryClient.invalidateQueries({ queryKey });
    },
  });
};
usePutaway.permission = ['inventory.stock.operate'] as const satisfies PermissionRequirement;

export const useReturnInbound = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: ReturnInboundDto, idempotencyKey) => inboundClient.return({ ...data, idempotencyKey }),
    onSuccess: () => {
      for (const queryKey of inboundOperationInvalidationKeys()) queryClient.invalidateQueries({ queryKey });
    },
  });
};
useReturnInbound.permission = ['inventory.stock.operate'] as const satisfies PermissionRequirement;

export const useCancelInbound = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: CancelInboundDto, idempotencyKey) => inboundClient.cancel({ ...data, idempotencyKey }),
    onSuccess: () => {
      for (const queryKey of inboundOperationInvalidationKeys()) queryClient.invalidateQueries({ queryKey });
    },
  });
};
useCancelInbound.permission = ['inventory.stock.operate'] as const satisfies PermissionRequirement;

export const useUpdateInboundLineMemo = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ lineId, data }: { lineId: string; data: UpdateInboundLineMemoDto }) =>
      inboundClient.lines.memo(lineId, data),
    onSuccess: () => {
      for (const queryKey of inboundOperationInvalidationKeys()) queryClient.invalidateQueries({ queryKey });
    },
  });
};
useUpdateInboundLineMemo.permission = ['inventory.stock.operate'] as const satisfies PermissionRequirement;

// ===== 회수(Returns) =====

export const useCreateReturn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateReturnDto) => returnsClient.createReturn(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'returns'] });
    },
  });
};
useCreateReturn.permission = ['inventory.stock.adjust'] as const satisfies PermissionRequirement;

export const useReceiveReturn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ReceiveReturnDto }) =>
      returnsClient.receiveReturn(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'returns'] });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.return(id) });
    },
  });
};
useReceiveReturn.permission = ['inventory.stock.adjust'] as const satisfies PermissionRequirement;

export const useInspectReturn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: InspectReturnDto }) =>
      returnsClient.inspectReturn(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'returns'] });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.return(id) });
    },
  });
};
useInspectReturn.permission = ['inventory.stock.adjust'] as const satisfies PermissionRequirement;

export const useProcessReturn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ProcessReturnDto }) =>
      returnsClient.processReturn(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'returns'] });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.return(id) });
    },
  });
};
useProcessReturn.permission = ['inventory.stock.adjust'] as const satisfies PermissionRequirement;

// ===== 즉시 이동(Movement) =====

export const useMoveImmediately = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: MoveBatchRequestDto, idempotencyKey) => movementClient.moveImmediately({ ...data, idempotencyKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'movement', 'history'] });
    },
  });
};
useMoveImmediately.permission = ['inventory.stock.operate'] as const satisfies PermissionRequirement;

// ===== 보충 규칙(#743 B) =====

function invalidateReplenishmentRules(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.replenishmentRulesRoot });
  // 규칙은 제안에 즉시 반영된다(스펙 §6 「반영 시점」) — 제안 캐시도 버린다.
  queryClient.invalidateQueries({ queryKey: ['replenishment'] });
}

export const useUpdateReplenishmentSettings = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateReplenishmentSettingsDto) => replenishmentClient.rules.updateSettings(dto),
    onSuccess: () => invalidateReplenishmentRules(queryClient),
  });
};
useUpdateReplenishmentSettings.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useUpdateReplenishmentGrades = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (items: GradeRuleDto[]) => replenishmentClient.rules.updateGrades(items),
    onSuccess: () => invalidateReplenishmentRules(queryClient),
  });
};
useUpdateReplenishmentGrades.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useUpsertSupplierRule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ supplierId, dto }: { supplierId: string; dto: UpsertLeadTimeRuleDto }) =>
      replenishmentClient.rules.putSupplier(supplierId, dto),
    onSuccess: () => invalidateReplenishmentRules(queryClient),
  });
};
useUpsertSupplierRule.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useDeleteSupplierRule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (supplierId: string) => replenishmentClient.rules.deleteSupplier(supplierId),
    onSuccess: () => invalidateReplenishmentRules(queryClient),
  });
};
useDeleteSupplierRule.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useUpsertRouteRule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to, dto }: { from: string; to: string; dto: UpsertLeadTimeRuleDto }) =>
      replenishmentClient.rules.putRoute(from, to, dto),
    onSuccess: () => invalidateReplenishmentRules(queryClient),
  });
};
useUpsertRouteRule.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useDeleteRouteRule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => replenishmentClient.rules.deleteRoute(from, to),
    onSuccess: () => invalidateReplenishmentRules(queryClient),
  });
};
useDeleteRouteRule.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useUpsertSkuOverride = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ skuId, dto }: { skuId: string; dto: UpsertSkuOverrideDto }) =>
      replenishmentClient.rules.putSkuOverride(skuId, dto),
    onSuccess: () => invalidateReplenishmentRules(queryClient),
  });
};
useUpsertSkuOverride.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;

export const useDeleteSkuOverride = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (skuId: string) => replenishmentClient.rules.deleteSkuOverride(skuId),
    onSuccess: () => invalidateReplenishmentRules(queryClient),
  });
};
useDeleteSkuOverride.permission = ['inventory.master.write'] as const satisfies PermissionRequirement;
