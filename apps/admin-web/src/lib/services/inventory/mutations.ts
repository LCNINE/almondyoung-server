// src/lib/services/inventory/mutations.ts
'use client';

import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryQueryKeys } from './query-keys';
import { lineExecutionInvalidationKeys } from './line-execution-invalidation';
import { isCustomError } from '../../api/customError';
import { inventoryMatchingClient } from '../../api/domains/inventory';
import { stocksClient } from '../../api/domains/inventory/stocks.client';
import { skusClient } from '../../api/domains/inventory/skus.client';
import { skuGroupsClient } from '../../api/domains/inventory/sku-groups.client';
import { warehousesClient } from '../../api/domains/inventory/warehouses.client';
import { transfersClient } from '../../api/domains/inventory/transfers.client';
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
  ClosePlanItemRequest,
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
  ReceiveFromPlanDto,
  CreateReturnDto,
  ReceiveReturnDto,
  InspectReturnDto,
  ProcessReturnDto,
  MoveBatchRequestDto,
} from '../../types/dto/inventory';

/**
 * 멱등 키 수명주기를 관리하는 mutation 래퍼 (P2-4, 스펙 §5).
 * - 키를 ref 로 유지: react-query 재시도·네트워크 오류 후 재클릭이 같은 키 재사용 → 서버 replay
 * - 성공 시 키 교체(다음 제출은 새 작업), 4xx 시 교체(서버 미커밋 확정)
 * - 네트워크/타임아웃/5xx 는 키 유지: 서버가 커밋했을 수 있으므로 재시도가 replay 돼야 함
 */
function useIdempotentMutation<TVars, TData>(opts: {
  mutationFn: (vars: TVars, idempotencyKey: string) => Promise<TData>;
  onSuccess?: (data: TData, vars: TVars) => void;
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
    mutationFn: (data: CreateSupplierRequest) => suppliersClient.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.suppliers() });
    },
  });
};

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

export const useDeleteSupplier = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => suppliersClient.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.suppliers() });
    },
  });
};

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

export const useCreateHolder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateHolderRequest) => holdersClient.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.holders() });
    },
  });
};

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

export const useScanLocation = () => {
  return useMutation({
    mutationFn: (data: ScanLocationRequest) => stocktakingClient.scanLocation(data),
  });
};

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

export const useUpdateLineCount = () => {
  return useMutation({
    mutationFn: ({ lineId, data }: { lineId: string; data: UpdateLineCountRequest }) =>
      stocktakingClient.updateLineCount(lineId, data),
  });
};

export const useGenerateAdjustments = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, data }: { sessionId: string; data?: GenerateAdjustmentsRequest }) =>
      stocktakingClient.generateAdjustments(sessionId, data),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({
        queryKey: inventoryQueryKeys.stocktakingVariances(vars.sessionId),
      });
    },
  });
};

export const useCompleteStocktakingSession = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => stocktakingClient.completeSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'stocktaking', 'sessions'] });
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

export const useReconcileReservations = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => reservationsClient.reconcileReservations(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'reservations'] });
    },
  });
};

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
    // 가능해진다. 전역 mutation 기본값이 retry:1 이라, 서버는 커밋됐는데
    // 응답만 유실된 요청이 재시도 뒤 409 로 돌아오는 경우도 있다 — 그때는 실제로
    // 성공한 액션이 실패 토스트와 함께 옛 화면 위에 뜨므로 무효화가 더더욱 필요하다.
    onSettled: (_res, _err, { poId }) => {
      for (const queryKey of lineExecutionInvalidationKeys(poId)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

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
    // 가능해진다. 전역 mutation 기본값이 retry:1 이라, 서버는 커밋됐는데
    // 응답만 유실된 요청이 재시도 뒤 409 로 돌아오는 경우도 있다 — 그때는 실제로
    // 성공한 액션이 실패 토스트와 함께 옛 화면 위에 뜨므로 무효화가 더더욱 필요하다.
    onSettled: (_res, _err, { poId }) => {
      for (const queryKey of lineExecutionInvalidationKeys(poId)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

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

export const useClosePlanItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      planId,
      itemId,
      data,
    }: {
      planId: string;
      itemId: string;
      data: ClosePlanItemRequest;
    }) => inboundClient.closePlanItem(planId, itemId, data),
    // 잎 종결은 발주 헤더까지 파생으로 밀 수 있다 — 입고 키만 무효화하면
    // 발주 목록이 옛 상태를 보여준다. 라인 실행과 같은 키 묶음을 쓴다.
    onSettled: (_res, _err, { planId }) => {
      for (const queryKey of lineExecutionInvalidationKeys(planId)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

export const useAddToCart = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: AddToCartRequest) => purchaseOrdersClient.cart.add(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.purchaseOrderCart() });
    },
  });
};

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

export const useRemoveCartItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => purchaseOrdersClient.cart.remove(itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.purchaseOrderCart() });
    },
  });
};

export const useClearCart = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (type?: string) => purchaseOrdersClient.cart.clear(type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.purchaseOrderCart() });
    },
  });
};

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

export const useSimpleFullscanInbound = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: SimpleInboundDto, idempotencyKey) => inboundClient.simpleFullscan({ ...data, idempotencyKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.inbounds });
    },
  });
};

export const useIndividualInbound = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: IndividualInboundDto, idempotencyKey) => inboundClient.individual({ ...data, idempotencyKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.inbounds });
    },
  });
};

export const useVerifyBarcode = () => {
  return useMutation({
    mutationFn: (data: VerifyBarcodeRequest) => inboundClient.verifyBarcode(data),
  });
};

export const useReceiveFromPlan = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: ReceiveFromPlanDto, idempotencyKey) => inboundClient.plans.receive({ ...data, idempotencyKey }),
    // 입고가 이제 계획(2층)뿐 아니라 발주(3층, purchase_orders.status)까지 파생으로
    // 밀 수 있다 — 전량 입고 직후 이 무효화가 없으면 발주 화면이 옛 상태(confirmed)
    // 로 남는다(최종 전체 리뷰 발견 M1). 형제인 useClosePlanItem 은 이미 양쪽을
    // 무효화한다 — 여기도 lineExecutionInvalidationKeys 로 맞춘다. 그 함수는 id
    // 인자를 쓰지 않으므로(항상 같은 루트 키 묶음을 반환) planItemId 를 그대로
    // 넘겨도 무방하다.
    onSuccess: (_res, data) => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.inbounds });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.inboundPending() });
      for (const queryKey of lineExecutionInvalidationKeys(data.planItemId)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

export const usePutaway = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: PutawayRequestDto, idempotencyKey) => inboundClient.putaway({ ...data, idempotencyKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.inboundReceipts() });
    },
  });
};

export const useReturnInbound = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: ReturnInboundDto, idempotencyKey) => inboundClient.return({ ...data, idempotencyKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.inboundReceipts() });
    },
  });
};

export const useCancelInbound = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: CancelInboundDto, idempotencyKey) => inboundClient.cancel({ ...data, idempotencyKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.inboundReceipts() });
    },
  });
};

export const useUpdateInboundLineMemo = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ lineId, data }: { lineId: string; data: UpdateInboundLineMemoDto }) =>
      inboundClient.lines.memo(lineId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.inboundReceipts() });
    },
  });
};

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
