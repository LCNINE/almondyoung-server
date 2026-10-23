export type UnboxedDemandItem = {
  fulfillmentOrderItemId: string;
  fulfillmentOrderId: string;
  fulfillmentOrderStatus: string;
  salesOrderLineId: string | null;
  skuId: string;
  qty: number;
  canceledQty: number;
  shippedQty: number;
  /** 아래 두 칸은 판정에 쓰지 않는다 — 판매주문의 «출고 뒤 몫 보존» 효과 기록이 그대로 싣는 읽기 전용 값 */
  pickedQty: number;
  reservedQty: number;
  /** 지금 줄일 수 있는 미처리 수요 — FO 가 created·ready 면 max(0, qty − canceledQty − max(pickedQty, shippedQty)), 아니면 0 */
  cancellableQty: number;
};

export type UnboxedDemandReduction = { fulfillmentOrderItemId: string; qty: number };

export type ReducedDemandItem = {
  fulfillmentOrderItemId: string;
  fulfillmentOrderId: string;
  skuId: string;
  qty: number;
  previousCanceledQty: number;
  newCanceledQty: number;
  previousStatus: string;
  newStatus: string;
};

export type CanceledFulfillmentOrder = { fulfillmentOrderId: string; previousStatus: string };
