// src/lib/services/inventory/queries.ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { inventoryQueryKeys } from './query-keys';
import { inventoryMatchingClient } from '../../api/domains/inventory';

// 재고 관련 쿼리 (임시 구현)
export const useStocks = () => {
    return useQuery({
        queryKey: inventoryQueryKeys.stocks,
        queryFn: () => Promise.resolve([]),
    });
};

export const useStockSummary = () => {
    return useQuery({
        queryKey: inventoryQueryKeys.stockSummary,
        queryFn: () => Promise.resolve({ total: 0, available: 0 }),
    });
};

export const useSkuTotalStock = (sku: string) => {
    return useQuery({
        queryKey: inventoryQueryKeys.skuTotalStock(sku),
        queryFn: () => Promise.resolve({ sku, total: 0 }),
        enabled: !!sku,
    });
};

export const useSkuWarehouseStock = (sku: string, warehouseId: string) => {
    return useQuery({
        queryKey: inventoryQueryKeys.skuWarehouseStock(sku, warehouseId),
        queryFn: () => Promise.resolve({ sku, warehouseId, quantity: 0 }),
        enabled: !!sku && !!warehouseId,
    });
};

export const useStockHistory = (sku: string) => {
    return useQuery({
        queryKey: inventoryQueryKeys.stockHistory(sku),
        queryFn: () => Promise.resolve([]),
        enabled: !!sku,
    });
};

// SKU 관련 쿼리
export const useSkus = (query?: any) => {
    return useQuery({
        queryKey: inventoryQueryKeys.skus(query),
        queryFn: () => inventoryMatchingClient.skus.getSkus(query),
        staleTime: 2 * 60 * 1000, // 2분
    });
};

export const useSkuSearch = (searchQuery: string, page = 1, limit = 10) => {
    return useQuery({
        queryKey: inventoryQueryKeys.skuSearch(searchQuery, page, limit),
        queryFn: () => inventoryMatchingClient.skus.getSkus({
            name: searchQuery,
        }),
        enabled: !!searchQuery && searchQuery.length > 0,
        staleTime: 2 * 60 * 1000, // 2분
    });
};

export const useSku = (id: string) => {
    return useQuery({
        queryKey: inventoryQueryKeys.sku(id),
        queryFn: () => Promise.resolve({ id }),
        enabled: !!id,
    });
};

export const useSkuStockSummary = (sku: string) => {
    return useQuery({
        queryKey: inventoryQueryKeys.skuStockSummary(sku),
        queryFn: () => Promise.resolve({ sku, summary: [] }),
        enabled: !!sku,
    });
};

// SKU ID로 조회하는 함수 (기존 코드에서 사용)
export const useSkusByIds = (ids: string[]) => {
    return useQuery({
        queryKey: ['skus', 'by-ids', ids],
        queryFn: () => Promise.resolve([]),
        enabled: ids.length > 0,
    });
};

// 창고 관련 쿼리 (임시 구현)
export const useWarehouses = () => {
    return useQuery({
        queryKey: inventoryQueryKeys.warehouses,
        queryFn: () => inventoryMatchingClient.warehouses.list(),
    });
};

export const useWarehouse = (id: string) => {
    return useQuery({
        queryKey: inventoryQueryKeys.warehouse(id),
        queryFn: () => Promise.resolve({ id }),
        enabled: !!id,
    });
};

export const useWarehouseStockSummary = (warehouseId: string) => {
    return useQuery({
        queryKey: inventoryQueryKeys.warehouseStockSummary(warehouseId),
        queryFn: () => Promise.resolve({ warehouseId, summary: [] }),
        enabled: !!warehouseId,
    });
};

// 입고 관련 쿼리 (임시 구현)
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

// 검수 관련 쿼리 (임시 구현)
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

// 이동 관련 쿼리 (임시 구현)
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

// 통합 관련 쿼리 (임시 구현)
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
        staleTime: 2 * 60 * 1000, // 2분
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
export const useSuppliers = (query?: any) => {
    return useQuery({
        queryKey: inventoryQueryKeys.suppliers(query),
        queryFn: () => inventoryMatchingClient.suppliers.list(query),
        staleTime: 5 * 60 * 1000, // 5분
    });
};

export const useSupplierSearch = (query: string, page = 1, limit = 10) => {
    return useQuery({
        queryKey: inventoryQueryKeys.supplierSearch(query, page, limit),
        queryFn: () => inventoryMatchingClient.suppliers.search(query, page, limit),
        enabled: !!query && query.length > 0,
        staleTime: 2 * 60 * 1000, // 2분
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
export const useHolders = (query?: any) => {
    return useQuery({
        queryKey: inventoryQueryKeys.holders(query),
        queryFn: () => inventoryMatchingClient.holders.list(query),
        staleTime: 5 * 60 * 1000, // 5분
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
        staleTime: 2 * 60 * 1000, // 2분
    });
};

export const useHolder = (id: string) => {
    return useQuery({
        queryKey: inventoryQueryKeys.holder(id),
        queryFn: () => inventoryMatchingClient.holders.get(id),
        enabled: !!id,
    });
};