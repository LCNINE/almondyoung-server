// apps/channel-adapter/src/types.ts
import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  channelAdapterSchema,
  eventLogs,
  syncHistories,
  processedEvents,
  syncStatuses,
  wmsOrderMappings,
  pendingOrders,
  orderCollectionFailures,
  inboxEvents,
  pimMedusaMappings,
  cafe24MemberMappings,
} from './schema';

// DATABASE SERVICE 타입
export { channelAdapterSchema } from './schema';
export type ChannelAdapterSchema = typeof channelAdapterSchema;
export type DbService = import('@app/db').DbService<ChannelAdapterSchema>;
// EVENT LOGS 타입
export type EventLog = InferSelectModel<typeof eventLogs>;
export type NewEventLog = InferInsertModel<typeof eventLogs>;
export type UpdateEventLog = Partial<Omit<NewEventLog, 'id' | 'createdAt' | 'processedAt'>>;

// SYNC HISTORIES 타입
export type SyncHistory = InferSelectModel<typeof syncHistories>;
export type NewSyncHistory = InferInsertModel<typeof syncHistories>;
export type UpdateSyncHistory = Partial<Omit<NewSyncHistory, 'id' | 'createdAt'>>;

// PROCESSED EVENTS 타입
export type ProcessedEvent = InferSelectModel<typeof processedEvents>;
export type NewProcessedEvent = InferInsertModel<typeof processedEvents>;
export type UpdateProcessedEvent = Partial<Omit<NewProcessedEvent, 'idempotencyKey' | 'createdAt'>>;

// SYNC STATUSES 타입
export type SyncStatus = InferSelectModel<typeof syncStatuses>;
export type NewSyncStatus = InferInsertModel<typeof syncStatuses>;
export type UpdateSyncStatus = Partial<Omit<NewSyncStatus, 'id' | 'createdAt'>>;

// WMS ORDER MAPPINGS 타입
export type WmsOrderMapping = InferSelectModel<typeof wmsOrderMappings>;
export type NewWmsOrderMapping = InferInsertModel<typeof wmsOrderMappings>;
export type UpdateWmsOrderMapping = Partial<Omit<NewWmsOrderMapping, 'id' | 'createdAt'>>;

// PENDING ORDERS 타입 (미매핑 주문 계류)
export type PendingOrder = InferSelectModel<typeof pendingOrders>;
export type NewPendingOrder = InferInsertModel<typeof pendingOrders>;
export type UpdatePendingOrder = Partial<Omit<NewPendingOrder, 'id' | 'createdAt'>>;

export type PendingOrderStatus = 'pending_mapping' | 'processing' | 'completed' | 'failed';

// ORDER COLLECTION FAILURES 타입 (주문 수집 실패 격리)
export type OrderCollectionFailure = InferSelectModel<typeof orderCollectionFailures>;
export type NewOrderCollectionFailure = InferInsertModel<typeof orderCollectionFailures>;
export type UpdateOrderCollectionFailure = Partial<Omit<NewOrderCollectionFailure, 'id' | 'createdAt'>>;

// 'closed_lifecycle': the quarantined order reached a terminal lifecycle (canceled/refunded →
// no longer eligible for collection) before its mapping gap was fixed, so it will never be
// collected and the quarantine is closed rather than left open for a replay that can't succeed.
export type OrderCollectionFailureStatus = 'quarantined' | 'replayed' | 'closed_lifecycle';

// INBOX EVENTS 타입 (Kafka 이벤트 수신 처리)
export type InboxEvent = InferSelectModel<typeof inboxEvents>;
export type NewInboxEvent = InferInsertModel<typeof inboxEvents>;
export type UpdateInboxEvent = Partial<Omit<NewInboxEvent, 'id' | 'createdAt'>>;

// PIM-MEDUSA MAPPINGS 타입
export type PimMedusaMapping = InferSelectModel<typeof pimMedusaMappings>;
export type NewPimMedusaMapping = InferInsertModel<typeof pimMedusaMappings>;
export type UpdatePimMedusaMapping = Partial<Omit<NewPimMedusaMapping, 'id' | 'createdAt'>>;

// CAFE24 MEMBER MAPPINGS 타입
export type Cafe24MemberMapping = InferSelectModel<typeof cafe24MemberMappings>;
export type NewCafe24MemberMapping = InferInsertModel<typeof cafe24MemberMappings>;

export interface UnmappedItem {
  channelItemId: string;
  channelItemName: string;
  channelOptionName?: string;
}

export type DataType = 'orders' | 'order_status' | 'claims' | 'inventory' | 'products';

export interface SyncResult {
  success: boolean;
  processedCount?: number;
  failedCount?: number;
  errors?: Array<{ id?: string; message: string }>;
  data?: any; // API 응답 데이터
}

// 내부 데이터 타입들

// 내부 PIM 시스템의 상품 데이터 형식
export interface InternalProductData {
  id: string;
  name: string;
  price: number;
  description: string;
  categoryId?: string;
  brand?: string;
  options?: Array<{
    name: string;
    value: string;
    additionalPrice?: number;
  }>;
}

// 내부 WMS 시스템의 재고 데이터 형식
export interface InternalInventoryData {
  productId: string; // 네이버의 originProductNo 또는 내부 상품 ID
  stockQuantity: number;
  isOptionProduct: boolean; // 옵션 상품 여부
  reservedQuantity?: number;
  availableQuantity?: number;
  warehouseId?: string;
  // 옵션 상품인 경우 필요한 추가 정보
  optionInfo?: {
    optionCombinations?: Array<{
      id: number;
      stockQuantity: number;
      price?: number;
      usable?: boolean;
    }>;
    optionStandards?: Array<{
      id: number;
      stockQuantity: number;
      usable?: boolean;
    }>;
  };
}

// 내부 주문 상태 업데이트 데이터 형식
export interface InternalOrderStatusData {
  orderId: string;
  status: string;
  updatedAt: string;
  reason?: string;
}

// 동기화 페이로드 타입들 (식별 가능한 유니언)

// 상품 정보 동기화를 위한 페이로드
export interface ProductSyncPayload {
  dataType: 'products';
  payload: InternalProductData;
}

// 재고 정보 동기화를 위한 페이로드
export interface InventorySyncPayload {
  dataType: 'inventory';
  payload: InternalInventoryData;
}

// 주문 상태 동기화를 위한 페이로드
export interface OrderStatusSyncPayload {
  dataType: 'order_status';
  payload: InternalOrderStatusData;
}

// 모든 동기화 타입의 유니언
export type SyncToChannelPayload = ProductSyncPayload | InventorySyncPayload | OrderStatusSyncPayload;

export type ClaimType = 'CANCEL' | 'RETURN' | 'EXCHANGE';

export interface ClaimInfo {
  claimId: string;
  claimType: ClaimType;
  status?: string;
  reason?: string;
  quantity?: number;
  completedDate?: string;
}

export interface DispatchInfo {
  deliveryMethod: string;
  trackingNumber?: string;
  deliveryCompanyCode?: string;
  promiseDeliveryDate?: string; // (쿠팡) 약속 배송일
  dispatchedAt?: string;
}

export interface BuyerInfo {
  name?: string;
  contact?: string;
  address?: {
    postalCode?: string;
    roadAddress?: string;
    detailAddress?: string;
  };
}

// 주문 조회 쿼리 타입

// 단일 주문 조회를 위한 표준 쿼리 객체 타입
export type OrderQuery =
  | { by: 'channelShipmentId'; id: string } // 쿠팡의 shipmentBoxId
  | { by: 'channelProductOrderId'; id: string } // 네이버의 productOrderId
  | { by: 'channelOrderId'; id: string }; // 쿠팡의 orderId, 네이버의 orderId

// Consumer 이벤트 타입들 (Kafka 메시지)

// WMS에서 발행하는 재고 변경 이벤트
export interface StockChangedEvent {
  sku: string; // 상품 SKU
  deltaQty: number; // 변경량 (+50, -10 등)
  reason: 'INBOUND' | 'OUTBOUND' | 'ADJUSTMENT' | 'DAMAGE'; // 변경 사유
  warehouseId?: string; // 창고 ID (선택사항)
  eventVersion: number; // 이벤트 버전 (timestamp 또는 sequence)
  occurredAt: string; // 이벤트 발생 시각 (ISO 8601)
}

// WMS에서 발행하는 이행 상태 업데이트 이벤트
export interface FulfillmentUpdatedEvent {
  orderId: string; // 내부 주문 ID
  fulfillmentNo: string; // 이행 번호
  status: 'PREPARING' | 'SHIPPED' | 'DELIVERED' | 'RETURNED'; // 이행 상태
  trackingNo?: string; // 송장 번호
  carrier?: string; // 택배사 코드
  shippedAt?: string; // 출고 시각
  deliveredAt?: string; // 배송 완료 시각
  eventVersion: number; // 이벤트 버전
  occurredAt: string; // 이벤트 발생 시각
}

// PIM에서 발행하는 상품 정보 업데이트 이벤트
export interface ProductUpdatedEvent {
  productId: string; // 상품 ID
  changes: {
    name?: string; // 상품명 변경
    price?: number; // 가격 변경
    description?: string; // 설명 변경
    categoryId?: string; // 카테고리 변경
    status?: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED'; // 판매 상태 변경
  };
  eventVersion: number; // 이벤트 버전
  occurredAt: string; // 이벤트 발생 시각
}

// 내부 이행 데이터 형식 (WMS → Channel 동기화용)
export interface InternalFulfillmentData {
  orderId: string; // 내부 주문 ID
  status: string; // 이행 상태
  trackingInfo?: {
    companyCode: string; // 택배사 코드
    trackingNumber: string; // 송장 번호
  };
  shippedAt?: string; // 출고 시각
  deliveredAt?: string; // 배송 완료 시각
  updatedAt: string; // 업데이트 시각
}

// InternalOrderEvent는 이제 @app/shared/channel-adapter.types에서 import
export type { InternalOrderEvent } from '@packages/domain-types';

// 표준 내부 교환 이벤트 모델

export interface InternalExchangeEvent {
  eventId: string; // 고유 이벤트 ID
  eventType: 'exchange_created' | 'exchange_updated' | 'exchange_completed' | 'exchange_rejected';

  // 핵심 식별자들 (표준화된 내부 ID)
  claimId: string; // 내부 표준 클레임 ID (쿠팡 exchangeId 등을 번역)
  orderId: string; // 내부 표준 주문 ID

  // 채널 정보
  channel: 'naver_smartstore' | 'coupang' | 'medusa';
  externalClaimId: string; // 외부 채널의 원본 교환 ID
  externalOrderId: string; // 외부 채널의 원본 주문 ID

  // 교환 상태 (표준화)
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';

  // 귀책사유 (표준화)
  faultType: 'SELLER' | 'CUSTOMER' | 'DELIVERY' | 'PRODUCT_DEFECT' | 'OTHER';

  // 요청 정보
  reason: string; // 교환 사유 (고객이 입력한 원본 텍스트)
  reasonCode?: string; // 표준화된 사유 코드

  // 교환 상품 정보 (핵심 필드만)
  exchangeItems: Array<{
    originalItemId: string; // 원본 주문 상품 ID
    originalItemName: string;
    targetItemId?: string; // 교환할 상품 ID (있는 경우)
    targetItemName?: string;
    quantity: number;
    unitPrice: number;
  }>;

  // 배송 정보
  deliveryInfo?: {
    returnAddress?: {
      customerName: string;
      address: string;
      phone: string;
    };
    deliveryAddress?: {
      customerName: string;
      address: string;
      phone: string;
    };
    collectStatus?: 'PENDING' | 'COLLECTED' | 'COMPLETED';
    deliveryStatus?: 'PENDING' | 'SHIPPED' | 'DELIVERED';
  };

  // 타임스탬프
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601

  // 메타데이터
  metadata?: {
    originalPayload?: any; // 원본 외부 데이터 (디버깅용)
    processingNotes?: string[];
    channelSpecificData?: Record<string, any>; // 채널별 고유 데이터
  };
}

// 표준 내부 반품 이벤트 모델
export interface InternalReturnEvent {
  eventId: string;
  eventType: 'return_created' | 'return_updated' | 'return_completed' | 'return_rejected';

  // 핵심 식별자들
  claimId: string; // 내부 표준 클레임 ID
  orderId: string; // 내부 표준 주문 ID

  // 채널 정보
  channel: 'naver_smartstore' | 'coupang' | 'medusa';
  externalClaimId: string;
  externalOrderId: string;

  // 반품 상태 (표준화)
  status: 'PENDING' | 'APPROVED' | 'COLLECTED' | 'COMPLETED' | 'REJECTED';

  // 귀책사유 (표준화)
  faultType: 'SELLER' | 'CUSTOMER' | 'DELIVERY' | 'PRODUCT_DEFECT' | 'OTHER';

  // 요청 정보
  reason: string;
  reasonCode?: string;

  // 반품 상품 정보
  returnItems: Array<{
    orderItemId: string;
    itemName: string;
    quantity: number;
    unitPrice: number;
    returnQuantity: number;
  }>;

  // 회수 정보
  collectionInfo?: {
    collectionType: 'CUSTOMER_DIRECT' | 'PICKUP_REQUEST' | 'DROP_OFF';
    trackingNumber?: string;
    carrierCode?: string;
    collectedAt?: string;
  };

  // 타임스탬프
  createdAt: string;
  updatedAt: string;

  // 메타데이터
  metadata?: {
    originalPayload?: any;
    processingNotes?: string[];
    channelSpecificData?: Record<string, any>;
  };
}

// 표준 비즈니스 명령 (Standard Business Commands)

export type ChannelCommand =
  // 주문 관리 (Order Management)
  | {
      type: 'order.prepare'; // 주문 준비 (네이버: order.confirm, 쿠팡: order.acknowledge)
      orderIds: string[]; // 내부 표준 주문 ID들
    }
  | {
      type: 'order.cancel'; // 주문 취소
      orderId: string;
      reason?: string;
    }

  // 발송 관리 (Dispatch Management)
  | {
      type: 'dispatch.ship'; // 발송 처리 (네이버/쿠팡: dispatch.confirm)
      orderId: string;
      items?: Array<{ orderItemId: string; quantity: number }>;
      tracking: { companyCode: string; number: string };
      dispatchedAt?: string;
    }
  | {
      type: 'dispatch.update_tracking'; // 송장 정보 업데이트 (쿠팡: dispatch.update)
      orderId: string;
      tracking: { companyCode: string; number: string };
    }
  | {
      type: 'dispatch.delay'; // 발송 지연
      orderId: string;
      delayedUntil: string;
      reason: string;
    }

  // 반품 관리 (Return Management)
  | {
      type: 'return.approve'; // 반품 승인 (네이버/쿠팡 공통)
      claimId: string; // 내부 표준 클레임 ID
      items?: Array<{ orderItemId: string; quantity: number }>;
    }
  | {
      type: 'return.confirm_receipt'; // 반품 상품 입고 확인
      claimId: string;
    }
  | {
      type: 'return.process_shipment_stop'; // 출고중지 처리
      claimId: string;
      reason?: string;
    }
  | {
      type: 'return.process_already_shipped'; // 이미출고 처리
      claimId: string;
      tracking: { companyCode: string; number: string };
    }
  | {
      type: 'return.register_collection_invoice'; // 회수송장 등록
      claimId: string;
      collectionType: 'RETURN' | 'EXCHANGE';
      tracking: { companyCode: string; number: string };
    }
  | {
      type: 'return.hold'; // 반품 보류
      claimId: string;
      reason?: string;
    }
  | {
      type: 'return.release_hold'; // 반품 보류 해제
      claimId: string;
    }
  | {
      type: 'return.reject'; // 반품 거부
      claimId: string;
      reason: string;
    }

  // 교환 관리 (Exchange Management)
  | {
      type: 'exchange.confirm_pickup'; // 교환 회수 완료
      claimId: string;
    }
  | {
      type: 'exchange.reship'; // 교환 재발송
      claimId: string;
      tracking: { companyCode: string; number: string };
    }
  | {
      type: 'exchange.confirm_receipt'; // 교환 상품 입고 확인
      claimId: string;
    }
  | {
      type: 'exchange.reject'; // 교환 거부
      claimId: string;
      reason: string;
    }
  | {
      type: 'exchange.upload_invoice'; // 교환 재발송 송장 업로드
      claimId: string;
      tracking: { companyCode: string; number: string };
      items?: Array<{ itemId: string; shipmentBoxId: string }>;
    }
  | {
      type: 'exchange.hold'; // 교환 보류
      claimId: string;
      reason?: string;
    }
  | {
      type: 'exchange.release_hold'; // 교환 보류 해제
      claimId: string;
    };

// 조회 명령 (Query Commands)

export type ChannelQuery =
  | {
      type: 'delivery.history'; // 배송 히스토리 조회
      orderId: string;
    }
  | {
      type: 'return.withdrawal_history'; // 반품 철회 이력 조회
      dateFrom: string;
      dateTo: string;
      pageIndex?: number;
      sizePerPage?: number;
    }
  | {
      type: 'return.withdrawal_history_by_claims'; // 특정 클레임들의 철회 이력
      claimIds: string[];
    }
  | {
      type: 'exchange.requests'; // 교환 요청 목록 조회
      dateFrom: string;
      dateTo: string;
      status?: 'RECEIPT' | 'PROGRESS' | 'SUCCESS' | 'REJECT' | 'CANCEL';
      orderId?: number;
      pageIndex?: number;
      sizePerPage?: number;
    }
  | {
      type: 'order.status'; // 주문 상태 조회
      orderId: string;
    }
  | {
      type: 'claim.details'; // 클레임 상세 정보
      claimId: string;
    };

// PIM-Medusa 동기화 타입

// PIM Active Version 스냅샷 (동기화 소스 데이터)
export interface PimProductSnapshot {
  // Master/Version 식별
  masterId: string;
  versionId: string;
  version: number;

  // 기본 정보
  name: string;
  handle?: string; // 고유 slug
  description?: string;
  descriptionHtml?: string;
  thumbnail?: string;
  images?: Array<{
    fileId: string;
    url: string;
    isPrimary: boolean;
    sortOrder: number;
  }>;

  // SEO
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string[];

  // 분류
  categoryIds?: string[];
  categories?: Array<{
    id: string;
    name: string;
    slug: string;
    path: string;
    parentId: string | null;
    isActive: boolean;
    visibility: boolean;
    showOnMainCategory: boolean;
    thumbnail?: string;
  }>;
  brand?: string;
  tags?: string[];
  productType?: string;

  // 옵션 그룹
  optionGroups?: Array<{
    id: string;
    name: string;
    values: Array<{
      id: string;
      name: string;
      colorCode?: string;
      imageUrl?: string;
    }>;
  }>;

  // Variants
  variants: Array<{
    id: string; // PIM variant ID
    variantName?: string;
    sku?: string;
    variantCode?: string;
    isDefault: boolean;
    status: string;
    displayOrder?: number;
    optionCombination?: Array<{ name: string; value: string }>;

    // 가격 정보
    basePrice?: number;
    membershipPrice?: number;
    tieredPrices?: Array<{ minQuantity: number; price: number }>;

    // 물리적 속성 (Optional)
    weight?: number;
    length?: number;
    width?: number;
    height?: number;
    originCountry?: string;
    midCode?: string;
    hsCode?: string;
    material?: string;
  }>;

  // 메타데이터
  status: 'draft' | 'active' | 'inactive';
  isWholesaleOnly?: boolean;
  isMembershipOnly?: boolean;
  isGiftcard?: boolean;
  discountable?: boolean;
}

// Medusa Upsert Payload (변환 결과)
export interface MedusaProductPayload {
  // 필수 기본 정보
  title: string;
  handle: string; // pim-{masterId} 형태로 고정
  status: 'draft' | 'published' | 'proposed' | 'rejected';

  // 선택 정보
  description?: string;
  thumbnail?: string;
  images?: Array<{ url: string }>;

  // 옵션
  options?: Array<{
    title: string;
    values: string[];
  }>;

  // Variants
  variants?: Array<{
    id?: string;
    title: string;
    sku?: string;
    barcode?: string;
    ean?: string;
    upc?: string;
    inventory_quantity?: number;
    manage_inventory?: boolean;
    allow_backorder?: boolean;
    weight?: number;
    length?: number;
    width?: number;
    height?: number;
    origin_country?: string;
    mid_code?: string;
    hs_code?: string;
    material?: string;
    options?: Record<string, string>; // { "Color": "Red", "Size": "M" }
    prices?: Array<{
      amount: number;
      currency_code: string;
      rules?: Record<string, string>; // 가격 규칙
    }>;
    metadata?: {
      pimVariantId: string;
      variantCode?: string;
      displayOrder?: number;
      membershipPrice?: number;
      tieredPrices?: Array<{ minQuantity: number; price: number }>;
    };
  }>;

  // 분류
  categories?: Array<{ id: string }>;
  tags?: Array<{ value: string }>;
  collection_id?: string;
  type_id?: string;
  sales_channels?: Array<{ id: string }>;

  // 메타데이터 (핵심: PIM 추적용)
  metadata: {
    pimMasterId: string;
    pimVersionId: string;
    pimVersion: number;
    brand?: string;
    seoTitle?: string;
    seoDescription?: string;
    seoKeywords?: string[];
    isWholesaleOnly?: boolean;
    isMembershipOnly?: boolean;
    productType?: string;
    syncedAt: string;
  };

  // 기타
  is_giftcard?: boolean;
  discountable?: boolean;
}

// Medusa Product 조회 응답 (단순화)
export interface MedusaProduct {
  id: string;
  title: string;
  handle: string;
  status: string;
  metadata?: {
    pimMasterId?: string;
    pimVersionId?: string;
    pimVersion?: number;
  };
  variants?: Array<{
    id: string;
    title: string;
    sku?: string;
    manage_inventory?: boolean | null;
    inventory_items?: Array<{
      inventory_item_id?: string;
      required_quantity?: number;
      inventory?: {
        id?: string;
        sku?: string | null;
        metadata?: Record<string, unknown> | null;
      };
    }>;
    metadata?: {
      pimVariantId?: string;
    };
  }>;
}

// PIM 이벤트: ProductMasterActiveVersionChanged
export interface PimActiveVersionChangedEvent {
  masterId: string;
  versionId: string | null;
  name: string | null;
  previousActiveVersionId: string | null;
  categoryIds?: string[];
  primaryCategoryId?: string | null;
  changeReason: 'published' | 'rollback' | 'unpublished';
  changedAt: string;
  snapshot?: PimProductSnapshot | null;
}
