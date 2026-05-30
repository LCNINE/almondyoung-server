// src/lib/services/orders/order-actions.ts
// 주문 관련 액션 헬퍼 함수들

// TODO: Core 주문 후속 사건 API 추가 필요
// ================================================================================================
// 현재 Core의 PATCH /sales-orders/:id (UpdateSalesOrderDto)는 운영 메모처럼 계약 외 필드만 수정한다.
// Payment Accepted 이후 SalesOrder의 고객/배송지/금액/원 라인은 수락 당시 계약 스냅샷이므로 직접
// 수정하지 않는다.
//
// 현재 지원 필드:
//   - processedAt (string)
//   - memo (string)
//
// ❌ 수락된 주문의 items/lines 추가/삭제/수정은 SalesOrder 자체 PATCH 대상이 아닙니다.
//
// 필요한 Core API/워크플로우:
// ------------------------------------------------------------------------------------------------
// 1. POST /sales-order-amendments
//    - Payment Accepted 이후 상품 추가/대체/수량/금액 보정 사건 기록
//    - 원 sales_order_lines는 보존하고 delta와 후속 출고/환불/CS 연결을 생성
//
// 2. POST /order-cancellations
//    - 전체/부분 취소 lifecycle 기록
//    - 출고 조정, 예약 해제, 환불은 별도 업무 연결로 추적
//
// 3. POST /sales-orders/:id/split 또는 출고 조정 워크플로우
//    - 계약 라인 수정이 아니라 운영상 분할/출고 조정 전용 처리
//    - Request Body: { lineIds: string[] } or { lines: Array<{ lineId: string; quantity: number }> }
//    - 응답: { originalOrder: SalesOrder; newOrder: SalesOrder }
//
// 참고: 구현 위치는 apps/core/src/modules/sales-order 하위 (구 apps/wms/src/order/sales-orders).
// ================================================================================================

import { orders } from '@/lib/api/domains';
import type { UpdateSalesOrderDto } from '@/lib/types/dto/orders';

/**
 * 주문 분할 (나누기)
 * 한 주문을 여러 주문으로 분할
 * - 동일한 주문번호 유지 (channelOrderId는 동일)
 * - 수령자명 뒤에 -1, -2 등 추가
 *
 * TODO: Core에 주문 분할/출고 조정 워크플로우 추가 필요
 */
export const splitOrder = async (params: {
  orderId: string;
  selectedLineIds: string[];
  originalOrder: any;
}): Promise<{ success: boolean; newOrderId?: string; error?: string }> => {
  // TODO: Core 워크플로우 API 추가 후 구현
  return {
    success: false,
    error: 'Core API 추가 필요: 주문 분할/출고 조정 워크플로우',
  };
};

/**
 * 수량 나누기
 * 특정 상품의 수량을 새 주문으로 분리
 *
 * TODO: Core에 주문 분할/출고 조정 워크플로우 추가 필요
 */
export const splitQuantity = async (params: {
  orderId: string;
  splits: Array<{ lineId: string; splitQty: number }>;
  originalOrder: any;
}): Promise<{ success: boolean; newOrderId?: string; error?: string }> => {
  // TODO: Core 워크플로우 API 추가 후 구현
  return {
    success: false,
    error: 'Core API 추가 필요: 주문 분할/출고 조정 워크플로우',
  };
};

/**
 * 주문 정보 수정 (입력확인)
 *
 * 현재는 메모만 수정 가능
 * 상품/수량/금액 보정은 SalesOrderAmendment 워크플로우가 생긴 뒤 별도 액션으로 지원
 */
export const updateOrderDetails = async (params: {
  orderId: string;
  updatedOrder: any;
}): Promise<{ success: boolean; error?: string }> => {
  const { orderId, updatedOrder } = params;

  try {
    // 현재는 메모만 수정 가능
    await orders.salesOrders.updateSalesOrder(orderId, {
      memo: updatedOrder.memo,
    });

    // TODO: SalesOrderAmendment API 추가 후 상품/수량/금액 보정 액션 연결

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || '주문 수정 중 오류가 발생했습니다.',
    };
  }
};

/**
 * 주문에 상품 추가
 *
 * TODO: SalesOrderAmendment API 추가 필요
 */
export const addOrderItem = async (params: {
  orderId: string;
  newItem: { skuId: string; quantity: number; unitPrice?: number };
  originalOrder: any;
}): Promise<{ success: boolean; error?: string }> => {
  // TODO: SalesOrderAmendment API 추가 후 구현
  return {
    success: false,
    error: 'Core API 추가 필요: SalesOrderAmendment',
  };
};
