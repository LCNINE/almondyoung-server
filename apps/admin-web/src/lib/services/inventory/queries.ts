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
import type {
  StockSummaryQuery,
  StockHistoryQuery,
  TransferJobQuery,
  ReservationTargetType,
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

// 입고 관련 쿼리 (미구현 — Phase 4)
export const useInbounds = () => {
  return useQuery({
    queryKey: inventoryQueryKeys.inbounds,
    queryFn: () => Promise.resolve([]),
  });
};

export const useInbound = (id: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.inbound(id),
    queryFn: () => Promise.resolve({ id }),
    enabled: !!id,
  });
};

export const useInboundItems = (inboundId: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.inboundItems(inboundId),
    queryFn: () => Promise.resolve([]),
    enabled: !!inboundId,
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
export const useSuppliers = (query?: Parameters<typeof inventoryMatchingClient.suppliers.list>[0]) => {
  return useQuery({
    queryKey: inventoryQueryKeys.suppliers(query),
    queryFn: () => inventoryMatchingClient.suppliers.list(query),
    staleTime: 5 * 60 * 1000,
  });
};

export const useSupplierSearch = (query: string, page = 1, limit = 10) => {
  return useQuery({
    queryKey: inventoryQueryKeys.supplierSearch(query, page, limit),
    queryFn: () => inventoryMatchingClient.suppliers.search(query, page, limit),
    enabled: !!query && query.length > 0,
    staleTime: 2 * 60 * 1000,
  });
};

export const useSupplier = (id: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.supplier(id),
    queryFn: () => inventoryMatchingClient.suppliers.get(id),
    enabled: !!id,
  });
};

// 재고소유 관련 쿼리
export const useHolders = (query?: Parameters<typeof inventoryMatchingClient.holders.list>[0]) => {
  return useQuery({
    queryKey: inventoryQueryKeys.holders(query),
    queryFn: () => inventoryMatchingClient.holders.list(query),
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
    queryFn: () => inventoryMatchingClient.holders.search(query, isOurAsset, page, limit),
    enabled: !!query && query.length > 0,
    staleTime: 2 * 60 * 1000,
  });
};

export const useHolder = (id: string) => {
  return useQuery({
    queryKey: inventoryQueryKeys.holder(id),
    queryFn: () => inventoryMatchingClient.holders.get(id),
    enabled: !!id,
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
