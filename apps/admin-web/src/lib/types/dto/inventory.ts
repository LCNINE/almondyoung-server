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
  isPrimary: boolean;
  packingUnit?: string | null;
}

export interface SupplierInfoDto {
  id: string;
  name: string;
}

export interface SkuImageDto {
  id: string;
  url: string;
  sortOrder: number;
}

export interface SkuGroupDto {
  id: string;
  name: string;
  code: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkuGroupResponseDto extends SkuGroupDto {
  memberCount: number;
}

export interface SkuGroupMemberDto {
  id: string;
  name: string;
  code: string;
  safetyStock: number;
  primaryLocationId?: string | null;
}

export interface SkuGroupMembersResponseDto {
  groupId: string;
  groupName: string;
  totalMembers: number;
  members: SkuGroupMemberDto[];
}

export interface BulkAddResultItemDto {
  skuId: string;
  success: boolean;
  error?: string;
}

export interface BulkAddSkusResponseDto {
  success: boolean;
  totalCount: number;
  successCount: number;
  failedCount: number;
  results: BulkAddResultItemDto[];
}

export interface CreateSkuGroupDto {
  name: string;
  code?: string;
  description?: string;
}

export interface UpdateSkuGroupDto {
  name?: string;
  description?: string;
}

export interface AddSkuToGroupDto {
  skuId: string;
}

export interface BulkAddSkusToGroupDto {
  skuIds: string[];
}

export interface InventoryMasterDto {
  id: string;
  name: string;
}

export interface CreateSkuDto {
  skuGroupId?: string;
  holderId?: string;
  name: string;
  optionKey?: string;
  source?: 'auto_matching' | 'manual_matching' | 'manual_entry';
  deliveryProfileId?: string;
  stockType?: 'physical' | 'infinite' | 'drop_shipped' | 'consignment';
  sale1m?: number;
  sale3m?: number;
  safetyStock?: number;
  supplierIds?: string[];
  categoryIds?: string[];
  businessProductName?: string;
  importDeclarationNumber?: string;
  logisticsPartnerId?: string;
  discount?: string;
  manufacturerStar?: string;
  productWeight?: number;
  dimensionWidth?: number;
  dimensionHeight?: number;
  dimensionDepth?: number;
  productMaterial?: string;
  koreanName?: string;
  maxDiscountQuantity?: number;
  packagingImporterName?: string;
  productDescription?: string;
  moq?: number;
  memo2?: string;
  memo3?: string;
  mainImageUrl?: string;
  imageUploadIds?: string[];
  currentStock?: number;
  expiryDateManagement?: boolean;
  expiryStartDate?: string;
  expiryEndDate?: string;
  manufacturingDateManagement?: boolean;
  isGeneralInventory?: boolean;
  validityStartDate?: string;
  validityEndDate?: string;
  primaryLocationId?: string;
  secondaryLocationId?: string;
  variantGroupCode?: string;
}

export type UpdateSkuDto = Partial<Omit<CreateSkuDto, 'source'>>;

export interface SkuDto {
  id: string;
  name: string;
  code: string;
  defaultBarcode?: string;
  deliveryProfileId?: string;
  sale1m?: number;
  sale3m?: number;
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

export type LocationType = 'standard' | 'zone';

export interface BaseLocationDto {
  id: string;
  warehouseId: string;
  code: string;
  locationType: LocationType;
  displayName: string;
  capacityLimit: number | null;
  fifoRank: number | null;
  isExpirySeparated: boolean;
  isActive: boolean;
  isSystem: boolean;
  systemRole: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StandardLocationDto extends BaseLocationDto {
  locationType: 'standard';
  rackId: string;
  binIdentifier: string;
  columnName?: string;
  rackNumber?: number;
}

export interface ZoneLocationDto extends BaseLocationDto {
  locationType: 'zone';
  rackId: string | null;
  binIdentifier: string | null;
}

export type LocationDto = StandardLocationDto | ZoneLocationDto;

export interface LocationColumnDto {
  id: string;
  warehouseId: string;
  columnName: string;
  displayOrder: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LocationRackDto {
  id: string;
  columnId: string;
  column: LocationColumnDto;
  rackNumber: number;
  defaultBinStart: number;
  defaultBinEnd: number;
  autoGenerateBins: boolean;
  physicalWidth: number | null;
  physicalHeight: number | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BinRangeRequest {
  start: number;
  end: number;
}

export interface BinSettingsRequest {
  autoGenerate: boolean;
  standardBins?: BinRangeRequest;
  customBins?: string[];
}

export interface CreateColumnRequest {
  columnName: string;
  displayOrder?: number;
}

export interface UpdateColumnRequest {
  columnName?: string;
  displayOrder?: number;
  isActive?: boolean;
}

export interface CreateRackRequest {
  columnName: string;
  rackNumber: number;
  binSettings: BinSettingsRequest;
  physicalWidth?: number;
  physicalHeight?: number;
  notes?: string;
}

export interface UpdateRackRequest {
  defaultBinStart?: number;
  defaultBinEnd?: number;
  autoGenerateBins?: boolean;
  physicalWidth?: number;
  physicalHeight?: number;
  notes?: string;
  isActive?: boolean;
}

export interface CreateZoneLocationRequest {
  code: string;
  displayName?: string;
  capacityLimit?: number;
  fifoRank?: number;
  isExpirySeparated?: boolean;
  notes?: string;
}

export interface UpdateLocationRequest {
  displayName?: string;
  capacityLimit?: number;
  fifoRank?: number;
  isExpirySeparated?: boolean;
  isActive?: boolean;
  notes?: string;
}

export interface AddCustomBinRequest {
  columnName: string;
  rackNumber: number;
  customBinName: string;
  displayName?: string;
  capacityLimit?: number;
  notes?: string;
}

export interface LocationFiltersDto {
  type?: LocationType;
  columnName?: string;
  rackNumber?: number;
  isActive?: boolean;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface LocationListResponseDto {
  items: LocationDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface LocationCreateResultDto {
  success: boolean;
  createdCount: number;
  errors?: string[];
  createdLocationCodes?: string[];
}

// ===== 입고 =====

export type InboundMethod = 'individual' | 'simple' | 'simple_fullscan' | 'planned';
export type InboundWorkLogType = 'INBOUND' | 'PUTAWAY' | 'RETURN' | 'CANCEL';
export type InboundReceiptStatus = 'posted' | 'draft' | 'cancelled' | 'voided';
export type InboundPlanType = 'source' | 'destination';

// 요청 DTOs
export interface SimpleInboundDto {
  warehouseId: string;
  items: Array<{
    skuId: string;
    quantity: number;
    memo?: string;
  }>;
}

export interface IndividualInboundDto {
  warehouseId: string;
  skuId: string;
  quantity: number;
  locationId?: string;
  memo?: string;
}

export interface PutawayRequestDto {
  lineId: string;
  toLocationId: string;
  quantity: number;
}

export interface ReturnInboundDto {
  lineId: string;
  quantity: number;
  reason?: string;
}

export interface CancelInboundDto {
  lineId: string;
  quantity: number;
}

export interface UpdateInboundLineMemoDto {
  memo: string;
}

export interface CreateInboundPlanDto {
  expectedDate: string;
  warehouseId: string;
  destinationWarehouseId?: string;
  linkedPurchaseOrderId: string;
  planType?: InboundPlanType;
  requiresTransfer?: boolean;
  parentPlanId?: string;
}

export interface InboundPlanItemInputDto {
  skuId: string;
  expectedQty: number;
}

export interface AddInboundPlanItemsDto {
  planId: string;
  items: InboundPlanItemInputDto[];
}

export interface ReceiveFromPlanDto {
  planItemId: string;
  quantity: number;
  locationId?: string;
  memo?: string;
}

export interface VerifyBarcodeRequest {
  barcode: string;
  expectedSkuId?: string;
}

// 쿼리 DTOs
export interface InboundReceiptsQuery {
  skuId?: string;
  warehouseId?: string;
  method?: InboundMethod;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface InboundWorkLogsQuery {
  warehouseId?: string;
  skuId?: string;
  type?: InboundWorkLogType;
  method?: InboundMethod;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface InboundStatusQuery {
  skuId?: string;
  warehouseId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface ListPlanItemsQueryDto {
  startDate?: string;
  endDate?: string;
  warehouseId?: string;
  skuId?: string;
}

// 응답 DTOs
export interface InboundReceiptLineDto {
  id: string;
  receiptId: string;
  skuId: string;
  quantity: number;
  originLocationId: string | null;
  eventId: string | null;
  memo: string | null;
  returnedQty: number;
  canceledQty: number;
  putawayFromOriginQty: number;
  planItemId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InboundReceiptDto {
  id: string;
  method: InboundMethod;
  warehouseId: string;
  locationId: string | null;
  occurredAt: string;
  status: InboundReceiptStatus;
  totalQuantity: number;
  journalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IndividualInboundResponseDto extends InboundReceiptDto {
  line: InboundReceiptLineDto;
}

export interface SimpleInboundResponseDto extends InboundReceiptDto {
  lines: InboundReceiptLineDto[];
}

export interface InboundReceiptsResponse {
  total: number;
  items: InboundReceiptDto[];
}

export interface InboundWorkLogDto {
  id: string;
  type: InboundWorkLogType;
  method: InboundMethod;
  skuId: string;
  warehouseId: string;
  quantity: number;
  locationId: string | null;
  receiptId: string | null;
  lineId: string | null;
  memo: string | null;
  occurredAt: string;
  createdAt: string;
}

export interface InboundWorkLogsResponse {
  total: number;
  items: InboundWorkLogDto[];
}

export interface VerifyBarcodeResponseDto {
  skuId: string;
  skuCode: string;
  skuName: string;
  isMatch: boolean;
  message?: string;
}

export interface InboundPlanItemDto {
  planItemId: string;
  planId: string;
  skuId: string;
  skuCode?: string;
  skuName?: string;
  expectedQty: number;
  receivedQty: number;
  status: 'pending' | 'confirmed';
  createdAt: string;
}

export interface InboundPlanItemsResponse {
  total: number;
  items: InboundPlanItemDto[];
}

export interface ReceiveFromPlanResponseDto {
  success: boolean;
  receiptId: string;
}

export interface InboundPendingItemDto {
  skuId: string;
  skuName: string;
  skuCode: string;
  expectedQty: number;
  receivedQty: number;
  pendingQty: number;
}

export interface InboundPendingDto {
  planId: string;
  planType: InboundPlanType;
  warehouseId: string;
  expectedDate: string | null;
  isLinkedPlan: boolean;
  sourcePlanStatus?: string;
  purchaseOrder: {
    id: string;
    type: 'domestic' | 'foreign';
    supplier?: {
      id: string;
      name: string;
    };
  };
  items: InboundPendingItemDto[];
  totalQuantity: number;
  totalPendingQuantity: number;
}

export interface InboundPendingListResponseDto {
  warehouseId?: string;
  totalPendingPlans: number;
  totalPendingQuantity: number;
  pendingPlans: InboundPendingDto[];
}

export interface InboundLineMemoResponse {
  success: boolean;
}

export interface InboundActionResponse {
  success: boolean;
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

export interface SkuResponseDto {
  id: string;
  name: string;
  code: string;
  deliveryProfileId?: string | null;
  stockType: 'physical' | 'infinite' | 'drop_shipped' | 'consignment';
  sale1m?: number | null;
  sale3m?: number | null;
  safetyStock: number;
  groupId?: string | null;
  optionKey?: string | null;
  skuGroup?: SkuGroupDto | null;
  barcodes: BarcodeDto[];
  suppliers: SupplierInfoDto[];
  categoryNames: string[];
  businessProductName?: string | null;
  importDeclarationNumber?: string | null;
  logisticsPartnerId?: string | null;
  discount?: string | null;
  manufacturerStar?: string | null;
  productWeight?: number | null;
  dimensionWidth?: number | null;
  dimensionHeight?: number | null;
  dimensionDepth?: number | null;
  productMaterial?: string | null;
  koreanName?: string | null;
  maxDiscountQuantity?: number | null;
  packagingImporterName?: string | null;
  productDescription?: string | null;
  moq?: number | null;
  memo2?: string | null;
  memo3?: string | null;
  mainImageUrl?: string | null;
  images?: SkuImageDto[];
  currentStock?: number | null;
  expiryDateManagement: boolean;
  expiryStartDate?: string | null;
  expiryEndDate?: string | null;
  manufacturingDateManagement: boolean;
  isGeneralInventory: boolean;
  validityStartDate?: string | null;
  validityEndDate?: string | null;
  primaryLocationId?: string | null;
  secondaryLocationId?: string | null;
  variantGroupCode?: string | null;
  isDeleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AddBarcodeDto {
  barcode: string;
  packingUnit?: number;
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
  groupId?: string;
  holderId?: string;
  limit?: number;
  offset?: number;
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
  data: InboundReceiptDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ===== 자동재고매칭 관련 타입들 =====
// 상품구분 타입
export type ProductType = '일반상품' | '세트상품';

// 재고소유 타입
export type StockOwnerType = '자사' | '위탁' | '직송';

// 공급처 정보
export interface SupplierContactDto {
  phone: string | null;
  fax: string | null;
  email: string | null;
}

export interface SupplierAddressDto {
  zipcode: string | null;
  address1: string | null;
  address2: string | null;
}

export interface SupplierBusinessInfoDto {
  businessRegNo: string | null;
  businessType: string | null;
  ceoName: string | null;
}

export interface SupplierPurchaseSettingsDto {
  isDirectDelivery: boolean | null;
  orderCutoffTime: string | null;
}

export interface SupplierPaymentInfoDto {
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountHolder: string | null;
  paymentMethod: string | null;
}

export interface SupplierCategoryInfoDto {
  id: string;
  name: string;
  description: string | null;
}

export interface SupplierDto {
  id: string;
  name: string;
  contact: SupplierContactDto | null;
  address: SupplierAddressDto | null;
  businessInfo: SupplierBusinessInfoDto | null;
  purchaseSettings: SupplierPurchaseSettingsDto | null;
  paymentInfo: SupplierPaymentInfoDto | null;
  description: string | null;
  memo: string | null;
  purchaseManagerId: string | null;
  defaultWarehouseId: string | null;
  categories: SupplierCategoryInfoDto[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateSupplierRequest {
  name: string;
  phone?: string;
  fax?: string;
  email?: string;
  zipcode?: string;
  address1?: string;
  address2?: string;
  businessRegNo?: string;
  businessType?: string;
  ceoName?: string;
  isDirectDelivery?: boolean;
  orderCutoffTime?: string;
  bankName?: string;
  bankAccountNo?: string;
  bankAccountHolder?: string;
  paymentMethod?: string;
  description?: string;
  memo?: string;
  purchaseManagerId?: string;
  defaultWarehouseId?: string;
  categoryIds?: string[];
}

export type UpdateSupplierRequest = Partial<CreateSupplierRequest>;

export interface SupplierFiltersDto {
  search?: string;
  categoryId?: string;
  purchaseManagerId?: string;
  page?: number;
  limit?: number;
  offset?: number;
}

export interface SupplierListResponseDto {
  data: SupplierDto[];
  total: number;
  page: number;
  limit: number;
}

export interface FilterOptionDto {
  value: string;
  label: string;
}

export interface SupplierFilterOptionsResponseDto {
  categories: FilterOptionDto[];
  managers: FilterOptionDto[];
  searchTypes: FilterOptionDto[];
}

// 공급처 분류
export interface SupplierCategoryDto {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSupplierCategoryRequest {
  name: string;
  description?: string;
}

export type UpdateSupplierCategoryRequest = Partial<CreateSupplierCategoryRequest>;

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

export interface HolderSearchQuery {
  search?: string;
  isOurAsset?: boolean;
  page?: number;
  limit?: number;
}

export type HolderFiltersDto = HolderSearchQuery;

// 검색 응답 DTO
export interface HolderSearchResponseDto {
  data: HolderDto[];
  total: number;
  page: number;
  limit: number;
}

export type HolderListResponseDto = HolderSearchResponseDto;

export interface CreateHolderRequest {
  name: string;
  isOurAsset: boolean;
}

export type UpdateHolderRequest = Partial<CreateHolderRequest>;

// ===== 재고 이동 (Transfer Jobs) =====
export interface TransferItemInputDto {
  skuId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
}

export interface CreateTransferJobDto {
  fromWarehouseId: string;
  toWarehouseId: string;
  items: TransferItemInputDto[];
  actorId?: string;
  memo?: string;
}

export interface MoveWithinWarehouseDto {
  skuId: string;
  warehouseId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
  actorId?: string;
  memo?: string;
}

export interface TransferJobLineDto {
  id: string;
  jobId: string;
  skuId: string;
  quantity: number;
  fromLocationId: string | null;
  toLocationId: string | null;
  eventId: string | null;
  memo: string | null;
  createdAt: string;
}

export interface BaseTransferJobDto {
  id: string;
  warehouseId: string;
  occurredAt: string;
  totalQuantity: number;
  journalId: string | null;
  actorId: string | null;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransferJobWithLinesDto extends BaseTransferJobDto {
  lines?: TransferJobLineDto[];
}

export interface TransferJobWithLineCountDto extends BaseTransferJobDto {
  lineCount: number;
}

export interface TransferJobListResponseDto {
  jobs: TransferJobWithLineCountDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface TransferJobStatusDto {
  jobId: string;
  total: number;
  executed: number;
  pending: number;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface CreateTransferJobResponseDto {
  jobId: string;
  journalId: string;
  lines: TransferJobLineDto[];
}

export interface ExecuteTransferJobResponseDto {
  jobId: string;
  linesExecuted: number;
}

export interface MoveWithinWarehouseResponseDto {
  jobId: string;
  journalId: string;
}

export interface TransferJobQuery {
  warehouseId?: string;
  limit?: number;
  offset?: number;
}

// ===== 재고 예약 (Reservations) =====
export type ReservationTargetType = 'FULFILLMENT_ORDER' | 'MOVEMENT_TASK';
export type ReservationStatus = 'pending' | 'confirmed' | 'released' | 'active';

export interface ReservationDto {
  id: string;
  targetType: ReservationTargetType;
  targetId: string;
  skuId: string;
  warehouseId: string;
  quantity: number;
  status: ReservationStatus;
  fulfillmentOrderItemId: string | null;
  timeoutAt: string | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReservationSummaryTargetDto {
  targetType: string;
  targetId: string;
  quantity: number;
}

export interface ReservationSummaryDto {
  skuId: string;
  warehouseId: string;
  totalReserved: number;
  byTarget: ReservationSummaryTargetDto[];
}

export interface ExpireStaleReservationsResponseDto {
  releasedCount: number;
  message: string;
}

// ===== 재고 실사 (Stocktaking) =====
export type StocktakingSessionStatus = 'draft' | 'in_progress' | 'completed';

export interface StocktakingSessionDto {
  id: string;
  warehouseId: string;
  sessionName: string;
  notes?: string | null;
  status: StocktakingSessionStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StocktakingVarianceDto {
  lineId: string;
  locationCode: string | null;
  skuName: string;
  skuCode: string;
  expectedQuantity: number;
  countedQuantity: number | null;
  variance: number | null;
  discrepancyPercent: number;
}

export interface CreateStocktakingSessionRequest {
  warehouseId: string;
  sessionName: string;
  notes?: string;
}

export interface StartStocktakingSessionResponse {
  sessionId: string;
  status: 'in_progress';
  message: string;
}

export interface ScanLocationRequest {
  sessionId: string;
  locationBarcode: string;
}

export interface ScanLocationExpectedItem {
  skuId: string;
  skuName: string;
  skuCode: string;
  barcode: string | null;
  expectedQuantity: number;
}

export interface ScanLocationResponse {
  locationId: string;
  locationCode: string;
  expectedItems: ScanLocationExpectedItem[];
}

export interface ScanProductRequest {
  sessionId: string;
  locationId: string;
  productBarcode: string;
  quantity?: number;
}

export interface ScanProductResponse {
  lineId: string;
  skuId: string;
  countedQuantity: number;
  expectedQuantity: number;
  variance: number;
}

export interface UpdateLineCountRequest {
  countedQuantity: number;
  notes?: string;
}

export interface UpdateLineCountResponse {
  lineId: string;
  countedQuantity: number;
  expectedQuantity: number;
  variance: number;
}

export interface GenerateAdjustmentsRequest {
  lineIds?: string[];
}

export interface GenerateAdjustmentsResponse {
  adjustmentsCreated: number;
  eventsPosted: number;
  message: string;
}

export interface CompleteStocktakingSessionResponse {
  sessionId: string;
  status: 'completed';
  completedAt: string;
  summary: {
    totalLines: number;
    discrepanciesFound: number;
    adjustmentsApplied: number;
  };
}

export interface StocktakingSessionQuery {
  warehouseId?: string;
  status?: StocktakingSessionStatus;
  limit?: number;
  offset?: number;
}

export interface StocktakingSessionListResponse {
  sessions: StocktakingSessionDto[];
  total: number;
}

// ─── 발주 (Purchase Orders) ───────────────────────────────────────────────────

export type PurchaseOrderType = 'domestic' | 'foreign';
export type PurchaseOrderStatus = 'created' | 'confirmed' | 'received';
export type PurchaseOrderAuditStatus = 'draft' | 'pending_audit' | 'approved';

export interface PurchaseOrderLineDto {
  skuId: string;
  quantity: number;
  unitPrice: number | null;
  sku?: {
    name: string;
    barcode: string | null;
  };
}

export interface PurchaseOrderDto {
  id: string;
  type: PurchaseOrderType;
  supplierId: string | null;
  expectedArrival: string | null;
  status: PurchaseOrderStatus;
  auditStatus: PurchaseOrderAuditStatus;
  createdAt: string;
  updatedAt: string;
  lines: PurchaseOrderLineDto[];
  supplier?: {
    id: string;
    name: string;
  };
}

export interface PurchaseOrderListResponseDto {
  data: PurchaseOrderDto[];
  total: number;
}

export interface PurchaseOrderListFilters {
  status?: PurchaseOrderStatus;
  type?: PurchaseOrderType;
  limit?: number;
  offset?: number;
}

export interface CreatePurchaseOrderLineRequest {
  skuId: string;
  quantity: number;
  unitPrice?: number;
}

export interface CreatePurchaseOrderRequest {
  type: PurchaseOrderType;
  supplierId: string;
  expectedArrival?: string;
  destinationWarehouseId: string;
  lines: CreatePurchaseOrderLineRequest[];
}

export interface UpdatePurchaseOrderStatusRequest {
  status: PurchaseOrderStatus;
  expectedArrival?: string;
}

export interface UpdatePurchaseOrderLinesRequest {
  lines: CreatePurchaseOrderLineRequest[];
}

export interface AddToCartRequest {
  skuId: string;
  quantity: number;
  type: PurchaseOrderType;
  supplierId?: string;
}

export interface UpdateCartItemRequest {
  quantity: number;
  supplierId?: string;
}

export interface CreatePurchaseOrderFromCartRequest {
  cartItemIds: string[];
  supplierId: string;
  expectedArrival?: string;
  destinationWarehouseId: string;
}

export interface SubmitForAuditRequest {
  notes?: string;
}

export interface ApprovePoRequest {
  approvalNotes?: string;
}

export interface RejectPoRequest {
  rejectionReason: string;
}

export interface CartItemDto {
  id: string;
  skuId: string;
  quantity: number;
  type: PurchaseOrderType;
  supplier: {
    id: string;
    name: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  sku: {
    name: string;
    barcode: string | null;
  };
}

export interface StockReorderSuggestionDto {
  skuId: string;
  skuName: string;
  currentStock: number;
  safetyStock: number;
  shortfall: number;
  suggestedOrder: number;
  onOrderQty: number;
  inTransferQty: number;
}

// ===== 회수(Returns) =====

export type ReturnStatus = 'requested' | 'received' | 'qc_passed' | 'qc_failed' | 'disposed';
export type ReturnQcStatus = 'pending' | 'passed' | 'failed';
export type ReturnProcessAction = 'restock' | 'dispose';

export interface ReturnItemDto {
  id: string;
  returnId: string;
  skuId: string;
  requestedQuantity: number;
  receivedQuantity: number | null;
  qcPassedQuantity: number | null;
  qcFailedQuantity: number | null;
  restockedQuantity: number | null;
  disposedQuantity: number | null;
  locationId: string | null;
  qcStatus: ReturnQcStatus | null;
  qcReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReturnDto {
  id: string;
  orderId: string | null;
  shipmentId: string | null;
  warehouseId: string;
  status: ReturnStatus;
  returnReason: string | null;
  qcInspectedAt: string | null;
  qcInspectedBy: string | null;
  qcNotes: string | null;
  restockQuantity: number;
  disposeQuantity: number;
  createdAt: string;
  updatedAt: string;
  items?: ReturnItemDto[];
}

export interface ReturnListResponseDto {
  returns: ReturnDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface ReturnFiltersDto {
  warehouseId?: string;
  status?: ReturnStatus;
  orderId?: string;
  limit?: number;
  offset?: number;
}

export interface CreateReturnItemDto {
  skuId: string;
  requestedQuantity: number;
}

export interface CreateReturnDto {
  orderId?: string;
  shipmentId?: string;
  warehouseId: string;
  returnReason: string;
  items: CreateReturnItemDto[];
}

export interface ReceiveReturnItemDto {
  returnItemId: string;
  receivedQuantity: number;
  locationId?: string;
}

export interface ReceiveReturnDto {
  returnId: string;
  items: ReceiveReturnItemDto[];
}

export interface InspectReturnItemDto {
  returnItemId: string;
  qcStatus: 'passed' | 'failed';
  qcPassedQuantity?: number;
  qcFailedQuantity?: number;
  qcReason?: string;
}

export interface InspectReturnDto {
  returnId: string;
  inspectedBy: string;
  items: InspectReturnItemDto[];
  qcNotes?: string;
}

export interface ProcessReturnItemDto {
  returnItemId: string;
  action: ReturnProcessAction;
  quantity: number;
  targetLocationId?: string;
  reason?: string;
}

export interface ProcessReturnDto {
  returnId: string;
  items: ProcessReturnItemDto[];
}

export interface CreateReturnResponseDto {
  returnId: string;
  items: ReturnItemDto[];
}

export interface ReceiveReturnResponseDto {
  returnId: string;
  journalId: string;
}

export interface InspectReturnResponseDto {
  returnId: string;
  status: string;
}

export interface ProcessReturnResponseDto {
  returnId: string;
  journalId: string;
  restocked: number;
  disposed: number;
}

// ===== 즉시 이동(Movement) =====

export interface MoveBatchLineDto {
  skuId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
  memo?: string;
}

export interface MoveBatchRequestDto {
  warehouseId: string;
  occurredAt?: string;
  actorId?: string;
  memo?: string;
  lines: MoveBatchLineDto[];
}

export interface MovementJobLineDto {
  id: string;
  jobId: string;
  skuId: string;
  quantity: number;
  fromLocationId: string | null;
  toLocationId: string | null;
  eventId: string | null;
  memo: string | null;
  createdAt: string;
}

export interface MovementJobDto {
  id: string;
  warehouseId: string;
  occurredAt: string;
  totalQuantity: number;
  journalId: string | null;
  actorId: string | null;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MovementJobWithLinesDto extends MovementJobDto {
  lines: MovementJobLineDto[];
}

export interface MovementWorkLogDto {
  id: string;
  type: string;
  timestamp: string;
  jobId: string | null;
  lineId: string | null;
  skuId: string | null;
  warehouseId: string | null;
  fromLocationId: string | null;
  toLocationId: string | null;
  quantity: number | null;
  eventId: string | null;
  reason: string | null;
}

export interface MovementHistoryResponseDto {
  logs: MovementWorkLogDto[];
  days: number;
  total: number;
}

export interface MovementHistoryQuery {
  skuId?: string;
  warehouseId?: string;
  days?: number;
}
