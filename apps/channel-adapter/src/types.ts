import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eventLogs, syncHistories } from './schema';

// ===== DATABASE SERVICE 타입 =====
export const channelAdapterSchema = {
  eventLogs,
  syncHistories,
} as const;

export type ChannelAdapterSchema = typeof channelAdapterSchema;
export type DbService = PostgresJsDatabase<ChannelAdapterSchema>;
// ===== EVENT LOGS 타입 =====
export type EventLog = InferSelectModel<typeof eventLogs>;
export type NewEventLog = InferInsertModel<typeof eventLogs>;
export type UpdateEventLog = Partial<
  Omit<NewEventLog, 'id' | 'createdAt' | 'processedAt'>
>;

// ===== SYNC HISTORIES 타입 =====
export type SyncHistory = InferSelectModel<typeof syncHistories>;
export type NewSyncHistory = InferInsertModel<typeof syncHistories>;
export type UpdateSyncHistory = Partial<
  Omit<NewSyncHistory, 'id' | 'createdAt'>
>;

export type DataType =
  | 'orders'
  | 'order_status'
  | 'claims'
  | 'inventory'
  | 'products';

export interface SyncResult {
  success: boolean;
  processedCount?: number;
  failedCount?: number;
  errors?: Array<{ id?: string; message: string }>;
  data?: any; // API 응답 데이터
}

// ===== 내부 데이터 타입들 =====

/** 내부 PIM 시스템의 상품 데이터 형식 */
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

/** 내부 WMS 시스템의 재고 데이터 형식 */
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

/** 내부 주문 상태 업데이트 데이터 형식 */
export interface InternalOrderStatusData {
  orderId: string;
  status: string;
  updatedAt: string;
  reason?: string;
}

// ===== 동기화 페이로드 타입들 (식별 가능한 유니언) =====

/** 상품 정보 동기화를 위한 페이로드 */
export interface ProductSyncPayload {
  dataType: 'products';
  payload: InternalProductData;
}

/** 재고 정보 동기화를 위한 페이로드 */
export interface InventorySyncPayload {
  dataType: 'inventory';
  payload: InternalInventoryData;
}

/** 주문 상태 동기화를 위한 페이로드 */
export interface OrderStatusSyncPayload {
  dataType: 'order_status';
  payload: InternalOrderStatusData;
}

/** 모든 동기화 타입의 유니언 */
export type SyncToChannelPayload =
  | ProductSyncPayload
  | InventorySyncPayload
  | OrderStatusSyncPayload;

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

// ===== 주문 조회 쿼리 타입 =====

/**
 * 단일 주문 조회를 위한 표준 쿼리 객체 타입
 * 내부 시스템은 이 타입을 사용하여 어떤 종류의 조회든 요청할 수 있습니다.
 */
export type OrderQuery =
  | { by: 'channelShipmentId'; id: string } // 쿠팡의 shipmentBoxId
  | { by: 'channelProductOrderId'; id: string } // 네이버의 productOrderId
  | { by: 'channelOrderId'; id: string }; // 쿠팡의 orderId, 네이버의 orderId

export interface InternalOrderEvent {
  channelType: 'naver_smartstore' | 'coupang' | 'medusa';
  externalOrderId: string; // 주문번호
  externalProductOrderId?: string; // 상품주문 단위 (네이버 productOrderId 등)
  status: string; // 주문 상태
  lastChangedType?: string; // (네이버) 상태 변경 타입
  lastChangedAt?: string; // 상태 변경 시각
  paymentDate?: string; // 결제 일시
  quantity: number; // 주문 수량
  remainQuantity?: number; // 클레임 후 남은 수량
  priceAmount: number; // 총 상품 가격
  discountAmount?: number; // 할인액
  buyer?: BuyerInfo; // 구매자/수취인 정보
  dispatch?: DispatchInfo; // 배송/발송 정보
  currentClaim?: ClaimInfo; // 진행 중인 클레임
  completedClaims?: ClaimInfo[]; // 완료된 클레임들
  createdAt?: string; // 외부 기준 생성시각
  updatedAt?: string; // 외부 기준 업데이트시각
}

// Command 패턴으로 채널별 액션을 유연하게 처리
export type ChannelCommand =
  | { type: 'order.confirm'; productOrderIds: string[] }
  | { type: 'cancel.request'; orderId: string; reason?: string }
  | { type: 'cancel.approve'; orderId: string }
  | {
      type: 'return.request';
      orderId: string;
      items?: Array<{ productOrderId?: string; qty: number }>;
      reason?: string;
    }
  | { type: 'return.approve'; claimId: string }
  | { type: 'return.hold'; claimId: string; reason?: string }
  | { type: 'return.releaseHold'; claimId: string }
  | { type: 'return.reject'; claimId: string; reason?: string }
  | { type: 'exchange.pickupCompleted'; claimId: string }
  | {
      type: 'exchange.reship';
      claimId: string;
      tracking: { companyCode: string; number: string };
    }
  | { type: 'exchange.hold'; claimId: string; reason?: string }
  | { type: 'exchange.releaseHold'; claimId: string }
  | { type: 'exchange.reject'; claimId: string; reason?: string }
  | {
      type: 'dispatch.confirm';
      orderId: string;
      productOrderIds?: string[];
      tracking: { companyCode: string; number: string };
      dispatchedAt?: string;
    }
  | { type: 'dispatch.delay'; orderId: string; reason?: string }
  | {
      type: 'dispatch.changeDesiredDate';
      orderId: string;
      desiredDate: string;
    };
