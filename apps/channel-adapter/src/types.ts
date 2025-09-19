import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { eventLogs, syncHistories } from './schema';
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

export interface InternalOrderEvent {
  channelType: 'naver_smartstore' | 'coupang';
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
