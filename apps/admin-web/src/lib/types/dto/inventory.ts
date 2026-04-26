// src/lib/types/dto/inventory.ts
// 재고 관련 DTO 타입 정의

import type { UUID } from './common';

// ===== 재고 기본 정보 =====
export interface StockDto {
  skuId: string;
  warehouseId: string;
  locationId: string;
  stockType: 'physical' | 'infinite' | 'drop_shipped' | 'consignment';
  quantity: number;
  lastUpdated: string;
}

export interface StockSummaryDto {
  skuId: string;
  skuName: string;
  warehouseId: string;
  warehouseName: string;
  currentQuantity: number;
  availableQuantity: number;
  reservedQuantity: number;
  inboundPendingQuantity: number;
  outboundPendingQuantity: number;
  lastUpdated: string;
}

export interface SkuTotalStockDto {
  skuId: string;
  totalRealQuantity: number;
  totalReservedQuantity: number;
  totalAvailableQuantity: number;
}

export interface StockDetailDto {
  id: string;
  realQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  location: Record<string, any>;
  expiryDate: string;
}

export interface SkuWarehouseStockDto {
  summary: {
    skuId: string;
    skuName: string;
    warehouseId: string;
    warehouseName: string;
    currentQuantity: number;
    availableQuantity: number;
    reservedQuantity: number;
    inboundPendingQuantity: number;
    outboundPendingQuantity: number;
    lastUpdated: string;
  };
  details: StockDetailDto[];
}

// ===== SKU 및 마스터 =====
export interface BarcodeDto {
  id: string;
  barcode: string;
  barcodeType: string;
  packingUnit?: string;
}

export interface InventoryMasterDto {
  id: string;
  name: string;
}

export interface CreateSkuDto {
  masterId?: string;
  masterName?: string;
  name: string;
  optionKey?: Record<string, string>;
  source: 'auto_matching' | 'manual_matching' | 'manual_entry';
  productName?: string;
  variantName?: string;
  deliveryProfileId?: string;
  sale1m?: number;
  sale3m?: number;
  supplierIds?: string[];
  categoryIds?: string[];
  barcodes?: Array<{
    barcode: string;
    barcodeType: string;
    packingUnit?: string;
  }>;
}

export interface SkuDto {
  id: string;
  name: string;
  code: string;
  defaultBarcode?: string;
  deliveryProfileId?: string;
  sale1m?: number;
  sale3m?: number;
  masterId?: string;
  optionKey?: Record<string, string>;
  master?: Record<string, any>;
  barcodes: BarcodeDto[];
  supplierNames?: string[];
  categoryNames?: string[];
  createdAt: string;
  updatedAt: string;
}

// ===== 창고 및 위치 =====
export interface WarehouseDto {
  id: string;
  name: string;
  type: 'domestic' | 'overseas' | 'bonded' | 'return';
  location: string;
  isActive?: boolean; // 스웨거에 없지만 기존 코드 호환성을 위해 유지
  createdAt?: string;
  updatedAt?: string;
}

export interface LocationDto {
  id: string;
  warehouseId: string;
  name: string;
  code: string;
  type: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ===== 입고 =====
export interface SimpleInboundDto {
  warehouseId: string;
  items: Array<{
    skuId: string;
    quantity: number;
    memo?: string;
  }>;
}

export interface SimpleInboundResponse {
  status: 'success';
  message: string;
  inboundId: string;
}

export interface UpdateMemoDto {
  memo: string;
}

export interface UpdateMemoResponse {
  status: 'success';
  message: string;
}

export interface InboundDto {
  id: string;
  warehouseId: string;
  status: 'created' | 'processing' | 'completed' | 'canceled';
  items: Array<{
    skuId: string;
    quantity: number;
    memo?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

// ===== 피킹 =====
export interface BatchPickOperationDto {
  skuId: string;
  locationCode: string;
  requiredQty: number;
  pickedQty: number;
}

export interface BatchPickOperationsResponseDto {
  batchId: string;
  operations: BatchPickOperationDto[];
}

export interface BatchPickProgressResponseDto {
  batchId: string;
  totalItems: number;
  pickedItems: number;
  progressRate: number;
}

export interface BatchPickDto {
  batchId: string;
  operations: Array<{
    skuId: string;
    locationCode: string;
    pickedQty: number;
  }>;
}

export interface BatchPickResponseDto {
  status: 'success' | 'failed';
  message: string;
  jobId: string;
}

// ===== 재고 이동 =====
export interface MoveLineDto {
  skuId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
  memo?: string;
}

export interface MoveBatchDto {
  warehouseId: string;
  occurredAt: string;
  actorId: string;
  memo?: string;
  lines: MoveLineDto[];
}

export interface MoveResponseDto {
  status: 'success' | 'failed';
  message: string;
  jobId: string;
}

// ===== 응답 타입들 =====
export interface StocksResponseDto {
  data: StockDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface StockSummariesResponseDto {
  data: StockSummaryDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SkusResponseDto {
  data: SkuDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ===== 누락된 타입들 추가 =====
export interface AdjustStockDto {
  skuId: string;
  warehouseId: string;
  locationId?: string;
  delta: number; // 변경할 수량(양수=가산, 음수=감산)
  reason: string;
}

export interface StockHistoryDto {
  id: string;
  eventType: string;
  deltaQuantity: number;
  eventTimestamp: string;
  reason?: string;
  orderId?: string;
}

export interface UpdateSkuDto {
  name?: string;
  description?: string;
  barcode?: string;
  isActive?: boolean;
}

export interface SkuResponseDto {
  id: string;
  name: string;
  code: string;
  defaultBarcode?: string;
  deliveryProfileId?: string;
  sale1m?: number;
  sale3m?: number;
  masterId?: string;
  optionKey?: Record<string, string>;
  master?: Record<string, any>;
  barcodes: BarcodeDto[];
  supplierNames?: string[];
  categoryNames?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AddBarcodeDto {
  barcode: string;
  isPrimary?: boolean;
}

export interface SkuStockSummaryDto {
  skuId: string;
  skuName: string;
  skuCode: string;
  totalRealQuantity: number;
  totalReservedQuantity: number;
  totalAvailableQuantity: number;
  warehouseStocks: string[];
}

export interface CreateWarehouseDto {
  name: string;
  type: 'domestic' | 'overseas' | 'bonded' | 'return';
  location: string;
}

export interface UpdateWarehouseDto {
  name?: string;
  type?: 'domestic' | 'overseas' | 'bonded' | 'return';
  location?: string;
}

export interface WarehouseStockSummaryDto {
  warehouseId: string;
  warehouseName: string;
  totalSkus: number;
  totalQuantity: number;
  totalAvailableQuantity: number;
  totalReservedQuantity: number;
}

// ===== 쿼리 타입들 =====
export interface StockQuery {
  skuId?: string;
  warehouseId?: string;
  locationId?: string;
  stockType?: 'physical' | 'infinite' | 'drop_shipped' | 'consignment';
  asOfTimestamp?: string; // ISO 8601 형식
}

export interface StockSummaryQuery {
  skuId?: string;
  warehouseId?: string;
  page?: number;
  limit?: number;
}

export interface StockHistoryQuery {
  skuId: string;
  warehouseId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface SkuQuery {
  id?: string;
  code?: string;
  barcode?: string;
  name?: string;
  supplierName?: string;
  masterId?: string;
}

export interface WarehousesResponseDto {
  data: WarehouseDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface LocationsResponseDto {
  data: LocationDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface InboundsResponseDto {
  data: InboundDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ===== 자동재고매칭 관련 타입들 =====
// 상품구분 타입
export type ProductType = '일반상품' | '세트상품' | '디지털상품';

// 재고소유 타입
export type StockOwnerType = '자사' | '위탁' | '직송';

// 공급처 정보
export interface SupplierDto {
  id: string;
  name: string;
  contactInfo?: {
    phone?: string;
    email?: string;
    address?: string;
  };
  defaultWarehouseId?: string;
  createdAt: string;
  updatedAt: string;
}

// 재고소유 정보
export interface HolderDto {
  id: string;
  name: string;
  isOurAsset: boolean;
  createdAt: string;
  updatedAt: string;
}

// 재고 옵션 DTO
export interface InventoryOptionDto {
  id?: string;
  name: string;
  image?: string;
  price: number;
}

// 자동재고매칭 요청 DTO
export interface CreateInventoryMatchingDto {
  // 기본 정보
  productType: ProductType;
  citizenProductName: string;
  supplierId: string;
  stockOwnerId: string;
  warehouseId: string;
  usage?: string;
  importDeclaration?: string;
  importCertificate?: string;
  optionDetail?: string;

  // 가격 정보
  costPrice: number;

  // 옵션 정보
  options: InventoryOptionDto[];

  // 추가 정보
  productDescription?: string;
  moq?: string;
  memo1?: string;
  memo2?: string;
  memo3?: string;
  memo4?: string;
}

// 자동재고매칭 응답 DTO (백엔드 스펙에 맞게 수정)
export interface InventoryMatchingResponseDto {
  id: string;
  sellingProductId: string;
  sellingProductName: string;
  sellingProductOption: string;
  productType: ProductType;
  supplierId: string;
  supplierName: string;
  stockOwnerId: string;
  stockOwnerName: string;
  warehouseId: string;
  warehouseName: string;
  skuMappings: {
    skuId: string;
    skuName: string;
    quantity: number;
  }[];
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

// 검색 쿼리 DTO
export interface SupplierSearchQuery {
  search?: string;
  page?: number;
  limit?: number;
}

export interface HolderSearchQuery {
  search?: string;
  isOurAsset?: boolean;
  page?: number;
  limit?: number;
}

// 검색 응답 DTO
export interface SupplierSearchResponseDto {
  data: SupplierDto[];
  total: number;
  page: number;
  limit: number;
}

export interface HolderSearchResponseDto {
  data: HolderDto[];
  total: number;
  page: number;
  limit: number;
}
