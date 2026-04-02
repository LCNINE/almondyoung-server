// src/lib/types/dto/orders.ts
// 주문 관련 DTO 타입 정의

import type { UUID } from './common';

// ===== 공통 타입 =====
/** WMS 실제 enum 값과 일치 */
export type SalesOrderStatus =
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'timeout';
export type FulfillmentStatus = 'created' | 'shipped' | 'canceled';
export type PurchaseOrderStatus =
  | 'created'
  | 'confirmed'
  | 'shipped'
  | 'delivered'
  | 'canceled';
export type InvoiceStatus = 'created' | 'shipped' | 'canceled';

// ===== 매칭 관련 (WMS API 스펙 기반) =====

// 매칭 상태
export type MatchingStatus = 'pending' | 'matched' | 'ignored';
export type MatchingStrategy = 'void' | 'variant' | 'option';
export type MatchingPriority = 'normal' | 'high';

// 재고 정책
export interface StockPolicyDto {
  inventoryManagement: boolean; // 재고 관리 여부 (true: 물리적 재고, false: 디지털)
  preStockSellable: boolean; // 재고 0이어도 선판매 가능 여부
  alwaysSellableZeroStock: boolean; // 재고 0이어도 항상 판매 가능 (직배/신상품)
}

// SKU 매핑
export interface SkuMappingDto {
  skuId: string; // SKU ID
  quantity: number; // 수량 (최소 1, 기본값 1)
}

// 옵션 매핑
export interface OptionMappingDto {
  optionName: string; // 옵션 이름 (예: CPU, RAM)
  optionValue: string; // 옵션 값 (예: i7, 16GB)
  skuId: string; // 매칭될 SKU ID
}

// 매칭 해소 요청
export interface ResolveMatchingDto {
  skuIds?: string[]; // 매칭될 SKU ID 목록 (matched 상태일 경우 최소 하나 이상의 UUID 필수)
  skuMappings?: SkuMappingDto[]; // 매칭될 SKU와 수량 정보 목록 (수동 매칭 시 수량 지정 필요한 경우)
  ignore: boolean; // 매칭을 무시할지 여부 (true인 경우 ignored 상태로 전환)
  strategy: MatchingStrategy; // 매칭 전략 (기본값: variant)
  stockPolicy: StockPolicyDto; // 재고 정책 설정
  isGift: boolean; // 사은품 여부 (기본값: false)
}

// 옵션별 매칭 해소
export interface ResolveOptionMatchingDto {
  optionMappings: OptionMappingDto[]; // 옵션별 SKU 매핑 목록
}

// 매칭 우선순위 설정
export interface SetMatchingPriorityDto {
  priority: MatchingPriority; // 매칭 우선순위
}

// 매칭 전략 변경
export interface ChangeStrategyDto {
  strategy: MatchingStrategy; // 변경할 매칭 전략
}

// 선택된 옵션
export interface SelectedOptionDto {
  optionName: string; // 옵션 이름
  optionValue: string; // 선택된 옵션 값
}

// Variant SKU 조회
export interface VariantSkuLookupDto {
  selectedOptions?: SelectedOptionDto[]; // 선택된 옵션 목록 (옵션별 매칭인 경우 필수)
}

// 매칭 대기 목록 조회 응답
export interface MatchingDto {
  id: string; // 매칭 ID
  variantId: string; // Variant ID
  status: MatchingStatus; // 매칭 상태
  priority: MatchingPriority; // 우선순위
  strategy: MatchingStrategy; // 매칭 전략
  stockPolicy: StockPolicyDto; // 재고 정책
  isGift: boolean; // 사은품 여부
  orderCount?: number; // 관련 주문 수
  createdAt: string; // 생성일시
  updatedAt: string; // 수정일시

  // include-order 옵션으로 조인된 주문 정보
  order?: {
    id: string;
    salesOrderId: string;
    salesChannel: string;
    channelOrderId: string;
    productName: string;
    optionName?: string;
    quantity: number;
    salesAmount: number;
    recipient: string;
    orderDate: string;
    shippingAddress?: string;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
  };

  // 매칭된 SKU 정보 (matched 상태일 때)
  matchedSkus?: SkuMappingDto[];

  // Variant 정보
  variant?: {
    id: string;
    name: string;
    masterId: string;
    optionKey?: Record<string, string>;
  };

  // Master 정보
  master?: {
    id: string;
    name: string;
  };
}

// 매칭 목록 조회 쿼리
export interface MatchingsQuery {
  status?: MatchingStatus; // 매칭 상태 필터
  limit?: number;
  offset?: number;
}

// 매칭 목록 응답
export interface MatchingsResponseDto {
  data: MatchingDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// ===== 주문 라인 매칭 현황 =====

export interface OrderLineMatchedSku {
  skuId: string;
  skuName: string;
  skuCode?: string;
  quantity: number;
}

// 주문 라인 하나 + 매칭 상태
export interface OrderLineDto {
  id: string;                        // sales_order_lines.id
  variantId: string;
  productName: string;               // 채널 상품명
  quantity: number;
  unitPrice?: number;
  totalPrice?: number;
  salesOrderId: string;
  channelOrderId: string;
  salesChannel: string;
  customerName?: string;
  customerPhone?: string;
  orderDate: string;
  matchingId?: string;               // product_matchings.id (null이면 PIM 미등록)
  matchingStatus?: MatchingStatus;   // null이면 PIM 미등록
  matchedSkus: OrderLineMatchedSku[];
}

export interface OrderLinesResponseDto {
  data: OrderLineDto[];
  total: number;
  page: number;
  limit: number;
}

export interface OrderLinesQuery {
  matchingStatus?: MatchingStatus | 'unregistered';
  excludeMatched?: boolean;
  salesChannel?: string;
  startDate?: string;
  endDate?: string;
  keyword?: string;
  keywordType?: 'productName' | 'orderNumber' | 'customerName';
  limit?: number;
  offset?: number;
}

// Variant별 매칭 조회
export interface VariantMatchingDto {
  variantId: string;
  status: MatchingStatus;
  stockPolicy: StockPolicyDto;
  isGift: boolean;
  matchedSkus?: SkuMappingDto[];
  createdAt: string;
  updatedAt: string;
}

// Variant SKU 조회 응답
export interface VariantSkuLookupResponseDto {
  skuId: string;
  quantity: number;
}

// 매칭 해소 응답
export interface ResolveMatchingResponseDto {
  id: string;
  status: MatchingStatus;
  message: string;
}

// 매칭 우선순위 설정 응답
export interface SetMatchingPriorityResponseDto {
  id: string;
  priority: MatchingPriority;
}

// 매칭 전략 변경 응답
export interface ChangeStrategyResponseDto {
  id: string;
  strategy: MatchingStrategy;
}

// 재고 정책 업데이트 응답
export interface UpdateStockPolicyResponseDto {
  id: string;
  stockPolicy: StockPolicyDto;
}

// ===== 판매 주문 =====
export interface SalesOrderItemDto {
  skuId: string;
  quantity: number;
  unitPrice: number;
}

export interface CreateSalesOrderDto {
  customerId: string;
  warehouseId: string;
  items: SalesOrderItemDto[];
  memo?: string;
}

export interface CreateSalesOrderResponseDto {
  id: string;
  status: 'created';
}

export interface SalesOrderDto {
  id: string;
  status: SalesOrderStatus;
  salesChannel: OrderSalesChannel;
  channelOrderId: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  shippingAddress: string; // json 값임
  shippingAddressHash: string | null;
  totalAmount: number | null;
  shippingFee: number;
  mergeGroupId: string | null;
  isMerged: boolean;
  orderDate: Date;
  lines: {
    variantId: string;
    productMatchingId?: string;
    productName?: string;
    quantity: number;
    unitPrice?: number;
    totalPrice?: number;
  }[];
  createdAt: string;
  updatedAt: string;
}

export interface OrderSalesChannel {
  id: string;
  type: string;
  name: string;
}

export interface SalesOrdersResponseDto {
  data: SalesOrderDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ===== 아웃바운드 배치 =====
export interface CreateOutboundBatchDto {
  warehouseId: string;
  pickingMethod: 'individual' | 'wave' | 'batch';
  name: string;
  scheduledPickingAt?: string;
}

export interface OutboundBatchDto {
  id: string;
  warehouseId: string;
  pickingMethod: 'individual' | 'wave' | 'batch';
  name: string;
  status: 'created' | 'picking_started' | 'completed' | 'canceled';
  fulfillmentOrders: string[];
  scheduledPickingAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOutboundBatchResponseDto {
  id: string;
  warehouseId: string;
  pickingMethod: 'individual' | 'wave' | 'batch';
  name: string;
  status: 'created';
  fulfillmentOrders: string[];
  scheduledPickingAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OutboundBatchesResponseDto {
  data: OutboundBatchDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ===== Fulfillment =====
export interface FulfillmentLineDto {
  skuId: string;
  quantity: number;
  reserved: number;
}

export interface FulfillmentDto {
  id: string;
  salesOrderId: string;
  warehouseId: string;
  status: FulfillmentStatus;
  shippingAddress: string;
  lines: FulfillmentLineDto[];
  createdAt: string;
}

export interface CreateFulfillmentDto {
  salesOrderId: string;
  warehouseId: string;
  ownerId: string;
  shippingAddress: string;
  lines: Array<{
    skuId: string;
    quantity: number;
  }>;
}

export interface FulfillmentsResponseDto {
  data: FulfillmentDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ===== 발주 =====
export interface PurchaseOrderLineDto {
  skuId: string;
  quantity: number;
  unitPrice: number;
}

export interface CreatePurchaseOrderDto {
  type: 'domestic' | 'foreign';
  supplierId: string;
  expectedArrival?: string;
  destinationWarehouseId: string;
  lines: CreatePurchaseOrderLineDto[];
}

export interface CreatePurchaseOrderLineDto {
  skuId: string;
  quantity: number;
  unitPrice: number;
}

export interface CreatePurchaseOrderResponseDto {
  id: string;
  type: 'domestic' | 'foreign';
  supplierId: string;
  expectedArrival?: string;
  destinationWarehouseId: string;
  status: 'created';
  lines: PurchaseOrderLineDto[];
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderDto {
  id: string;
  type: 'domestic' | 'foreign';
  supplierId: string;
  expectedArrival?: string;
  destinationWarehouseId: string;
  status: PurchaseOrderStatus;
  lines: PurchaseOrderLineDto[];
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrdersResponseDto {
  data: PurchaseOrderDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ===== 인보이스 =====
export interface InvoiceItemDto {
  skuId: string;
  quantity: number;
  unitPrice: number;
}

export interface CreateInvoiceDto {
  orderId: string;
  warehouseId: string;
  items: InvoiceItemDto[];
}

export interface InvoiceDto {
  id: string;
  orderId: string;
  warehouseId: string;
  status: InvoiceStatus;
  items: InvoiceItemDto[];
  totalAmount: number;
  trackingNumber?: string;
  shippingDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvoicesResponseDto {
  data: InvoiceDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ===== 누락된 타입들 추가 =====
export interface UpdateSalesOrderDto {
  customerId?: string;
  warehouseId?: string;
  items?: SalesOrderItemDto[];
  memo?: string;
}

export interface UpdateSalesOrderResponseDto {
  id: string;
  status: SalesOrderStatus;
}

export interface ConfirmSalesOrderResponseDto {
  id: string;
  status: 'confirmed';
}

export interface CancelSalesOrderResponseDto {
  id: string;
  status: 'canceled';
}

export interface MergeSalesOrdersDto {
  orderIds: string[];
  targetOrderId?: string;
}

export interface MergeSalesOrdersResponseDto {
  mergedOrderId: string;
  mergedOrderIds: string[];
}

// ===== Fulfillment Order 관련 =====
export interface CreateFulfillmentOrderDto {
  orderId: string;
  warehouseId: string;
  priority?: number;
}

export interface CreateFulfillmentOrderResponse {
  id: string;
  status: 'created';
}

export interface DeleteFulfillmentOrderResponse {
  id: string;
  status: 'deleted';
}

export interface UpdatePriorityDto {
  priority: number;
}

export interface UpdatePriorityResponse {
  id: string;
  priority: number;
}

export interface AllocateInventoryDto {
  skuId: string;
  quantity: number;
  locationId?: string;
}

export interface AllocateInventoryResponse {
  id: string;
  allocatedQuantity: number;
}

// ===== 쿼리 타입들 =====
/** WMS SalesOrderFilterDto와 일치 */
export interface SalesOrdersQuery {
  status?: SalesOrderStatus;
  channel?: 'medusa' | 'naver' | 'coupang' | '3pl';
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}
