// src/lib/types/ui/inventory.ts
// Inventory 도메인 UI 타입 정의

import type { StockDto, SkuResponseDto, WarehouseDto } from '../dto/inventory';

// UI에서 사용하는 재고 타입
export interface StockUI extends Omit<StockDto, 'lastUpdated'> {
    // UI 전용 필드들
    isSelected?: boolean;
    statusColor?: string;
    statusIcon?: string;
    formattedQuantity?: string;
    formattedReserved?: string;
    formattedAvailable?: string;
    stockStatus?: 'in_stock' | 'low_stock' | 'out_of_stock' | 'overstock';
    lastUpdated: string; // 원본 필드 유지
    formattedLastUpdated?: string;
}

// UI에서 사용하는 SKU 타입
export interface SkuUI extends SkuResponseDto {
    // UI 전용 필드들
    isSelected?: boolean;
    formattedPrice?: string;
    stockStatus?: 'in_stock' | 'low_stock' | 'out_of_stock';
    totalStock?: number;
    availableStock?: number;
    reservedStock?: number;
    warehouseCount?: number;
    barcodeCount?: number;
}

// UI에서 사용하는 창고 타입
export interface WarehouseUI extends WarehouseDto {
    // UI 전용 필드들
    isSelected?: boolean;
    statusColor?: string;
    statusIcon?: string;
    stockCount?: number;
    skuCount?: number;
    capacity?: number;
    utilizationRate?: number;
    formattedCapacity?: string;
    formattedUtilization?: string;
}

// 재고 목록 필터 타입
export interface StockListFilter {
    warehouseId?: string;
    skuId?: string;
    status?: 'in_stock' | 'low_stock' | 'out_of_stock' | 'overstock';
    search?: string;
    sortBy?: 'sku' | 'quantity' | 'warehouse' | 'lastUpdated';
    sortOrder?: 'asc' | 'desc';
}

// 재고 목록 페이지네이션 타입
export interface StockListPagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

// 재고 목록 응답 타입
export interface StockListResponse {
    data: StockUI[];
    pagination: StockListPagination;
    filters: StockListFilter;
}

// SKU 목록 필터 타입
export interface SkuListFilter {
    categoryId?: string;
    status?: 'active' | 'inactive';
    stockStatus?: 'in_stock' | 'low_stock' | 'out_of_stock';
    search?: string;
    sortBy?: 'name' | 'sku' | 'price' | 'stock';
    sortOrder?: 'asc' | 'desc';
}

// SKU 목록 페이지네이션 타입
export interface SkuListPagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

// SKU 목록 응답 타입
export interface SkuListResponse {
    data: SkuUI[];
    pagination: SkuListPagination;
    filters: SkuListFilter;
}

// 창고 목록 필터 타입
export interface WarehouseListFilter {
    status?: 'active' | 'inactive';
    search?: string;
    sortBy?: 'name' | 'capacity' | 'utilization' | 'stockCount';
    sortOrder?: 'asc' | 'desc';
}

// 창고 목록 페이지네이션 타입
export interface WarehouseListPagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

// 창고 목록 응답 타입
export interface WarehouseListResponse {
    data: WarehouseUI[];
    pagination: WarehouseListPagination;
    filters: WarehouseListFilter;
}

// 재고 조정 폼 타입
export interface StockAdjustmentForm {
    skuId: string;
    warehouseId: string;
    adjustmentType: 'add' | 'subtract' | 'set';
    quantity: number;
    reason: string;
    notes?: string;
}

// SKU 생성/수정 폼 타입
export interface SkuFormData {
    name: string;
    sku: string;
    description?: string;
    categoryId?: string;
    price: number;
    weight?: number;
    dimensions?: {
        length?: number;
        width?: number;
        height?: number;
    };
    barcodes?: string[];
}

// 창고 생성/수정 폼 타입
export interface WarehouseFormData {
    name: string;
    code: string;
    description?: string;
    address: {
        address1: string;
        address2?: string;
        city: string;
        postalCode: string;
        country: string;
    };
    capacity?: number;
    isActive: boolean;
}

// 재고 대시보드 타입
export interface InventoryDashboard {
    totalSkus: number;
    totalWarehouses: number;
    totalStock: number;
    lowStockItems: number;
    outOfStockItems: number;
    overstockItems: number;
    recentMovements: StockMovementUI[];
    topSkus: TopSkuUI[];
    warehouseUtilization: WarehouseUI[];
}

// 재고 이동 UI 타입
export interface StockMovementUI {
    id: string;
    skuId: string;
    skuName: string;
    warehouseId: string;
    warehouseName: string;
    type: 'in' | 'out' | 'adjustment' | 'transfer';
    quantity: number;
    formattedQuantity?: string;
    reason: string;
    timestamp: string;
    formattedTimestamp?: string;
    user?: string;
}

// 상위 SKU UI 타입
export interface TopSkuUI {
    skuId: string;
    skuName: string;
    totalStock: number;
    formattedStock?: string;
    warehouseCount: number;
    lastMovement?: string;
    formattedLastMovement?: string;
}

// 자동재고매칭 UI 타입
export interface InventoryMatchingUI {
    id: string;
    productType: string;
    citizenProductName: string;
    supplier: {
        id: string;
        name: string;
    };
    stockOwner: {
        id: string;
        name: string;
        isOurAsset: boolean;
    };
    warehouse: {
        id: string;
        name: string;
    };
    costPrice: number;
    options: Array<{
        id?: string;
        name: string;
        image?: string;
        price: number;
    }>;
    createdAt: string;
    formattedCreatedAt?: string;
}

// 자동재고매칭 폼 타입
export interface InventoryMatchingFormData {
    productType: string;
    citizenProductName: string;
    supplierId: string;
    stockOwnerId: string;
    warehouseId: string;
    usage?: string;
    importDeclaration?: string;
    importCertificate?: string;
    optionDetail?: string;
    costPrice: number;
    options: Array<{
        name: string;
        image?: string;
        price: number;
    }>;
    productDescription?: string;
    moq?: string;
    memo1?: string;
    memo2?: string;
    memo3?: string;
    memo4?: string;
}
