// src/lib/services/inventory/queries.ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { inventoryQueryKeys } from './query-keys';
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
  StockSummaryQuery,
  StockHistoryQuery,
  TransferJobQuery,
  ReservationTargetType,
  StocktakingSessionQuery,
  SupplierFiltersDto,
  HolderFiltersDto,
  LocationFiltersDto,
  PurchaseOrderListFilters,
  InboundReceiptsQuery,
  InboundWorkLogsQuery,
  InboundStatusQuery,
  ListPlanItemsQueryDto,
  ReturnFiltersDto,
  MovementHistoryQuery,
} from '../../types/dto/inventory';

export const useStocks = (query = {}) => {
  return useQuery({
    queryKey: [inventoryQueryKeys.stocks, query],
    queryFn: () => stocksClient.getStocks(query),
  });
};

export const useStockSummary = (query: StockSummaryQuery = {}) => {
  return useQuery({
    queryKey: inventoryQueryKeys.stockSummary(query),
    queryFn: () => stocksClient.getStockSummary(query),
  });
};

export const useSkuTotalStock = (skuId: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.skuTotalStock(skuId),
    queryFn: () => stocksClient.getSkuTotalStock(skuId),
    enabled: !!skuId,
  });
};

export const useSkuWarehouseStock = (skuId: string, warehouseId: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.skuWarehouseStock(skuId, warehouseId),
    queryFn: () => stocksClient.getSkuWarehouseStock(skuId, warehouseId),
    enabled: !!skuId && !!warehouseId,
  });
};

export const useStockHistory = (query: StockHistoryQuery) => {
  return useQuery({
    queryKey: inventoryQueryKeys.stockHistory(query),
    queryFn: () => stocksClient.getStockHistory(query),
    enabled: !!query.skuId,
  });
};

// SKU 관련 쿼리
export const useSkus = (query?: Parameters<typeof skusClient.getSkus>[0]) => {
  return useQuery({
    queryKey: inventoryQueryKeys.skus(query),
    queryFn: () => skusClient.getSkus(query),
    staleTime: 2 * 60 * 1000,
  });
};

export const useSkuSearch = (searchQuery: string, page = 1, limit = 10) => {
  return useQuery({
    queryKey: inventoryQueryKeys.skuSearch(searchQuery, page, limit),
    queryFn: () => skusClient.getSkus({ name: searchQuery }),
    enabled: !!searchQuery && searchQuery.length > 0,
    staleTime: 2 * 60 * 1000,
  });
};

export const useSku = (id: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.sku(id),
    queryFn: () => skusClient.getSku(id),
    enabled: !!id,
  });
};

export const useSkuStockSummary = (skuId: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.skuStockSummary(skuId),
    queryFn: () => skusClient.getSkuStockSummary(skuId),
    enabled: !!skuId,
  });
};

export const useSkusByIds = (ids: string[]) => {
  return useQuery({
    queryKey: ['skus', 'by-ids', ids],
    queryFn: () => Promise.resolve([]),
    enabled: ids.length > 0,
  });
};

// SKU 그룹 관련 쿼리
export const useSkuGroups = () => {
  return useQuery({
    queryKey: inventoryQueryKeys.skuGroups,
    queryFn: () => skuGroupsClient.getSkuGroups(),
    staleTime: 5 * 60 * 1000,
  });
};

export const useSkuGroup = (id: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.skuGroup(id),
    queryFn: () => skuGroupsClient.getSkuGroup(id),
    enabled: !!id,
  });
};

export const useSkuGroupMembers = (id: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.skuGroupMembers(id),
    queryFn: () => skuGroupsClient.getSkuGroupMembers(id),
    enabled: !!id,
  });
};

export const useUngroupedSkus = (params?: { limit?: number; offset?: number }) => {
  return useQuery({
    queryKey: inventoryQueryKeys.ungroupedSkus(params),
    queryFn: () => skuGroupsClient.getUngroupedSkus(params),
  });
};

// 창고 관련 쿼리
export const useWarehouses = () => {
  return useQuery({
    queryKey: inventoryQueryKeys.warehouses,
    queryFn: () => warehousesClient.getWarehouses(),
    staleTime: 5 * 60 * 1000,
  });
};

export const useWarehouse = (id: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.warehouse(id),
    queryFn: () => warehousesClient.getWarehouse(id),
    enabled: !!id,
  });
};

export const useWarehouseStockSummary = (warehouseId: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.warehouseStockSummary(warehouseId),
    queryFn: () => warehousesClient.getWarehouseStockSummary(warehouseId),
    enabled: !!warehouseId,
  });
};

// 입고 관련 쿼리
export const useInboundPending = (warehouseId?: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.inboundPending(warehouseId),
    queryFn: () => inboundClient.pending(warehouseId),
  });
};

export const useInboundReceipts = (query?: InboundReceiptsQuery) => {
  return useQuery({
    queryKey: inventoryQueryKeys.inboundReceipts(query),
    queryFn: () => inboundClient.receipts(query),
  });
};

export const useInboundWorkLogs = (query?: InboundWorkLogsQuery) => {
  return useQuery({
    queryKey: inventoryQueryKeys.inboundWorkLogs(query),
    queryFn: () => inboundClient.workLogs(query),
  });
};

export const useInboundStatus = (query?: InboundStatusQuery) => {
  return useQuery({
    queryKey: inventoryQueryKeys.inboundStatus(query),
    queryFn: () => inboundClient.status(query),
  });
};

export const useInboundPlanItems = (query?: ListPlanItemsQueryDto) => {
  return useQuery({
    queryKey: inventoryQueryKeys.inboundPlanItems(query),
    queryFn: () => inboundClient.plans.listItems(query),
  });
};

// 검수 관련 쿼리 (미구현 — Phase 4)
export const useInspections = () => {
  return useQuery({
    queryKey: inventoryQueryKeys.inspections,
    queryFn: () => Promise.resolve([]),
  });
};

export const useInspection = (id: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.inspection(id),
    queryFn: () => Promise.resolve({ id }),
    enabled: !!id,
  });
};

// 이동 관련 쿼리 (미구현 — Phase 4)
export const useMovements = () => {
  return useQuery({
    queryKey: inventoryQueryKeys.movements,
    queryFn: () => Promise.resolve([]),
  });
};

export const useMovement = (id: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.movement(id),
    queryFn: () => Promise.resolve({ id }),
    enabled: !!id,
  });
};

// 통합 관련 쿼리 (미구현 — Phase 4)
export const useConsolidations = () => {
  return useQuery({
    queryKey: inventoryQueryKeys.consolidations,
    queryFn: () => Promise.resolve([]),
  });
};

// 자동재고매칭 관련 쿼리
export const useInventoryMatchings = () => {
  return useQuery({
    queryKey: inventoryQueryKeys.inventoryMatchings(),
    queryFn: () => inventoryMatchingClient.matchings.list(),
    staleTime: 2 * 60 * 1000,
  });
};

export const useInventoryMatching = (id: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.inventoryMatching(id),
    queryFn: () => inventoryMatchingClient.matchings.get(id),
    enabled: !!id,
  });
};

// 공급처 관련 쿼리
export const useSuppliers = (filters?: SupplierFiltersDto) => {
  return useQuery({
    queryKey: inventoryQueryKeys.suppliers(filters),
    queryFn: () => suppliersClient.list(filters),
    staleTime: 5 * 60 * 1000,
  });
};

export const useSupplierFilterOptions = () => {
  return useQuery({
    queryKey: inventoryQueryKeys.supplierFilterOptions(),
    queryFn: () => suppliersClient.filterOptions(),
    staleTime: 10 * 60 * 1000,
  });
};

export const useSupplier = (id: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.supplier(id),
    queryFn: () => suppliersClient.get(id),
    enabled: !!id,
  });
};

// 공급처 분류 관련 쿼리
export const useSupplierCategories = () => {
  return useQuery({
    queryKey: inventoryQueryKeys.supplierCategories(),
    queryFn: () => supplierCategoriesClient.list(),
    staleTime: 10 * 60 * 1000,
  });
};

export const useSupplierCategory = (id: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.supplierCategory(id),
    queryFn: () => supplierCategoriesClient.get(id),
    enabled: !!id,
  });
};

// 재고소유 관련 쿼리
export const useHolders = (filters?: HolderFiltersDto) => {
  return useQuery({
    queryKey: inventoryQueryKeys.holders(filters),
    queryFn: () => holdersClient.list(filters),
    staleTime: 5 * 60 * 1000,
  });
};

export const useHolderSearch = (
  query: string,
  isOurAsset?: boolean,
  page = 1,
  limit = 10
) => {
  return useQuery({
    queryKey: inventoryQueryKeys.holderSearch(query, isOurAsset, page, limit),
    queryFn: () => holdersClient.list({ search: query, isOurAsset, page, limit }),
    enabled: !!query && query.length > 0,
    staleTime: 2 * 60 * 1000,
  });
};

export const useHolder = (id: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.holder(id),
    queryFn: () => holdersClient.get(id),
    enabled: !!id,
  });
};

// 로케이션 관련 쿼리
export const useLocations = (warehouseId: string, filters?: LocationFiltersDto) => {
  return useQuery({
    queryKey: inventoryQueryKeys.locations(warehouseId, filters),
    queryFn: () => locationsClient.list(warehouseId, filters),
    enabled: !!warehouseId,
  });
};

export const useLocation = (id: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.location(id),
    queryFn: () => locationsClient.get(id),
    enabled: !!id,
  });
};

export const useLocationColumns = (warehouseId: string, isActive?: boolean) => {
  return useQuery({
    queryKey: inventoryQueryKeys.locationColumns(warehouseId, isActive),
    queryFn: () => locationsClient.columns.list(warehouseId, isActive),
    enabled: !!warehouseId,
    staleTime: 2 * 60 * 1000,
  });
};

export const useLocationRacks = (
  warehouseId: string,
  columnName?: string,
  isActive?: boolean
) => {
  return useQuery({
    queryKey: inventoryQueryKeys.locationRacks(warehouseId, columnName, isActive),
    queryFn: () => locationsClient.racks.list(warehouseId, { columnName, isActive }),
    enabled: !!warehouseId,
    staleTime: 2 * 60 * 1000,
  });
};

// 재고 이동 관련 쿼리
export const useTransferJobs = (query: TransferJobQuery = {}) => {
  return useQuery({
    queryKey: inventoryQueryKeys.transferJobs(query),
    queryFn: () => transfersClient.listTransferJobs(query),
  });
};

export const useTransferJob = (id: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.transferJob(id),
    queryFn: () => transfersClient.getTransferJob(id),
    enabled: !!id,
  });
};

export const useTransferJobStatus = (id: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.transferJobStatus(id),
    queryFn: () => transfersClient.getTransferJobStatus(id),
    enabled: !!id,
  });
};

// 재고 예약 관련 쿼리
export const useReservationsBySku = (skuId: string, warehouseId?: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.reservationsBySku(skuId, warehouseId),
    queryFn: () => reservationsClient.getReservationsBySku(skuId, warehouseId),
    enabled: !!skuId,
  });
};

export const useReservationsByTarget = (
  targetType: ReservationTargetType,
  targetId: string
) => {
  return useQuery({
    queryKey: inventoryQueryKeys.reservationsByTarget(targetType, targetId),
    queryFn: () => reservationsClient.getReservationsByTarget(targetType, targetId),
    enabled: !!targetType && !!targetId,
  });
};

export const useReservationSummary = (warehouseId: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.reservationSummary(warehouseId),
    queryFn: () => reservationsClient.getReservationSummary(warehouseId),
    enabled: !!warehouseId,
  });
};

// 재고 실사 관련 쿼리
// NOTE: GET /stocktaking/sessions 목록 조회 엔드포인트가 서버에 미구현 — 빈 배열로 대체
export const useStocktakingSessions = (_query: StocktakingSessionQuery = {}) => {
  return useQuery({
    queryKey: inventoryQueryKeys.stocktakingSessions(_query),
    queryFn: (): Promise<{ sessions: never[]; total: number }> =>
      Promise.resolve({ sessions: [], total: 0 }),
  });
};

export const useStocktakingVariances = (sessionId: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.stocktakingVariances(sessionId),
    queryFn: () => stocktakingClient.getVariances(sessionId),
    enabled: !!sessionId,
  });
};

// 발주 관련 쿼리
export const usePurchaseOrders = (filters?: PurchaseOrderListFilters) => {
  return useQuery({
    queryKey: inventoryQueryKeys.purchaseOrders(filters),
    queryFn: () => purchaseOrdersClient.list(filters),
    staleTime: 2 * 60 * 1000,
  });
};

export const usePurchaseOrder = (id: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.purchaseOrder(id),
    queryFn: () => purchaseOrdersClient.get(id),
    enabled: !!id,
  });
};

export const usePurchaseOrderCart = () => {
  return useQuery({
    queryKey: inventoryQueryKeys.purchaseOrderCart(),
    queryFn: () => purchaseOrdersClient.cart.list(),
    staleTime: 30 * 1000,
  });
};

export const useReorderSuggestions = (warehouseId?: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.reorderSuggestions(warehouseId),
    queryFn: () => purchaseOrdersClient.suggestions.reorder(warehouseId),
    enabled: !!warehouseId,
    staleTime: 5 * 60 * 1000,
  });
};

// ===== 회수(Returns) =====

export const useReturns = (filters: ReturnFiltersDto = {}) => {
  return useQuery({
    queryKey: inventoryQueryKeys.returns(filters),
    queryFn: () => returnsClient.listReturns(filters),
    staleTime: 30 * 1000,
  });
};

export const useReturn = (id: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.return(id),
    queryFn: () => returnsClient.getReturn(id),
    enabled: !!id,
  });
};

// ===== 즉시 이동(Movement) =====

export const useMovementJob = (jobId: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.movementJob(jobId),
    queryFn: () => movementClient.getMovementJob(jobId),
    enabled: !!jobId,
  });
};

export const useMovementHistory = (query: MovementHistoryQuery = {}) => {
  return useQuery({
    queryKey: inventoryQueryKeys.movementHistory(query),
    queryFn: () => movementClient.getMovementHistory(query),
    staleTime: 30 * 1000,
  });
};
