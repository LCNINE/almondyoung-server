// src/lib/types/dto/orders.ts
// 주문 관련 DTO 타입 정의

import type { UUID } from './common';

// ===== 매칭 타입 re-export (lib/types/dto/matching.ts로 이전됨) =====
export type {
  MatchingStatus,
  MatchingStrategy,
  MatchingPriority,
  StockPolicyDto,
  SkuMappingDto,
  OptionMappingDto,
  ResolveMatchingDto,
  ResolveOptionMatchingDto,
  SetMatchingPriorityDto,
  ChangeStrategyDto,
  SelectedOptionDto,
  VariantSkuLookupDto,
  MatchingDto,
  MatchingsQuery,
  MatchingsResponseDto,
  OrderLineMatchedSku,
  OrderLineDto,
  OrderLinesResponseDto,
  OrderLinesQuery,
  VariantMatchingDto,
  VariantSkuLookupResponseDto,
  ResolveMatchingResponseDto,
  SetMatchingPriorityResponseDto,
  ChangeStrategyResponseDto,
  UpdateStockPolicyResponseDto,
  UpsertMatchingDto,
  MasterMatchingStatsDto,
} from './matching';

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

// ===== 주문 통계 =====
export interface OrderStatsDto {
  todayCount: number;
  outboundRequested: number;
  directShip: number;
  cannotShip: number;
  partialOutbound: number;
  waitingMatching: number;
  outboundComplete: number;
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
