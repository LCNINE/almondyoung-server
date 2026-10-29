/**
 * 새 반품 기록(K8 PR7) 응답·요청 모양 — 손으로 미러한다. 컴파일러가 드리프트를 못 잡으니 core 정의와 칸마다 맞출 것:
 *  - apps/core/src/modules/sales-order/customer-return/customer-return.reader.ts  (CustomerReturnView·ListItem·ListPage)
 *  - .../customer-return.types.ts, customer-return-attention.ts, dto/*.ts
 *  - apps/medusa/src/workflows/orders/returns/{plan-return-request,return-settlement-preview}.ts
 */

export type CustomerReturnStatus =
  | 'expected'
  | 'arrived'
  | 'inspected'
  | 'held'
  | 'refund_pending'
  | 'settled'
  | 'cancelled';

export type CustomerReturnReason =
  | 'change_of_mind'
  | 'defective'
  | 'not_as_described'
  | 'wrong_item'
  | 'damaged_in_shipping'
  | 'other';

export type CustomerReturnAttention =
  | 'held'
  | 'settlement_failed'
  | 'prepayment_failed'
  | 'partial_arrival'
  | 'refund_overdue'
  | 'pickup_failed';

export type CustomerReturnPickupStatus =
  | 'pending'
  | 'reserved'
  | 'failed'
  | 'void'
  | 'cancel_pending'
  | 'cancelled';

/** 반품의 마지막 회수(한진) 행 — core customer-return.reader.ts CustomerReturnPickupView 와 같다 */
export interface CustomerReturnPickup {
  status: CustomerReturnPickupStatus;
  waybillNo: string | null;
  originalWaybillNo: string | null;
  lastError: string | null;
  attempts: number;
  reservedAt: string | null;
  pickedUpAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

export type CustomerReturnBucket = 'open' | 'attention' | 'closed';

export interface ReturnSettlementDeduction {
  returnShipping: number;
  freeShippingBreak: number;
  roundTrip: number;
  hold?: number;
}

export interface CustomerReturnSettlement {
  state: 'in_progress' | 'refused' | 'stalled' | 'done';
  refundMode: 'auto' | 'manual';
  startedAt: string;
  lastIssuedAt: string;
  attempts: number;
  lastFailure: {
    code: string;
    message: string;
    retryable: boolean;
    received: boolean;
    at: string;
  } | null;
  issues?: number;
  command?: {
    holdDeduction?: { amount: number; memo: string };
    alreadyRefundedAmount?: number;
    closesMissing?: boolean;
  };
  restartedAt?: string;
  restartedBy?: string;
}

export interface CustomerReturnSettlementOutcome {
  refundAmount: number;
  shippingRefund?: number;
  deduction: ReturnSettlementDeduction;
  feeNotAdjusted: boolean;
  refundMode: 'auto' | 'manual';
  settledAt: string;
  prepaidAmount?: number;
  externalRefundApplied?: number;
}

export interface CustomerReturnPrepayment {
  state: 'in_progress' | 'refused' | 'stalled' | 'done' | 'superseded';
  refundMode: 'auto' | 'manual';
  requestedAmount: number | null;
  memo: string;
  requestedBy: string;
  startedAt: string;
  lastIssuedAt: string;
  attempts: number;
  issues: number;
  lastFailure: {
    code: string;
    message: string;
    retryable: boolean;
    at: string;
  } | null;
  outcome: {
    amount: number;
    refundMode: 'auto' | 'manual';
    prepaidAt: string;
  } | null;
  restartedAt?: string;
  restartedBy?: string;
}

export interface CustomerReturnCsResolution {
  missing?: { memo: string; by: string; at: string };
  hold?: {
    deduction: number;
    memo: string;
    by: string;
    at: string;
    dropped?: { by: string; at: string };
  };
}

export interface CustomerReturnViewItem {
  id: string;
  skuId: string;
  skuName: string;
  skuCode: string;
  qtyPerUnit: number;
  expectedQty: number;
  arrivedQty: number;
  acceptedQty: number | null;
  rejectedQty: number | null;
  heldQty: number | null;
}

export interface CustomerReturnViewLine {
  id: string;
  salesOrderLineId: string;
  channelOrderItemId: string;
  productName: string;
  quantity: number;
  missingQty: number;
  items: CustomerReturnViewItem[];
}

export interface CustomerReturnView {
  id: string;
  salesOrderId: string;
  order: { orderNo: string; channelOrderId: string; salesChannel: string };
  channelReturnId: string;
  status: CustomerReturnStatus;
  reason: string;
  note: string | null;
  feeBearer: string;
  requestedBy: string;
  warehouseId: string | null;
  windowOverrideReason: string | null;
  requestedAt: string;
  cancelledAt: string | null;
  arrivedAt: string | null;
  refundDueAt: string | null;
  inspectedAt: string | null;
  settledAt: string | null;
  settlement: CustomerReturnSettlement | null;
  settlementOutcome: CustomerReturnSettlementOutcome | null;
  prepayment: CustomerReturnPrepayment | null;
  csResolution: CustomerReturnCsResolution | null;
  pickup: CustomerReturnPickup | null;
  lines: CustomerReturnViewLine[];
}

export interface CustomerReturnListItem {
  id: string;
  salesOrderId: string;
  orderNo: string;
  channelOrderId: string;
  /** 개인정보 — 서버가 가린 값이 올 수 있다 */
  customerName: string | null;
  status: CustomerReturnStatus;
  reason: string;
  feeBearer: string;
  requestedBy: string;
  requestedAt: string;
  arrivedAt: string | null;
  refundDueAt: string | null;
  settledAt: string | null;
  cancelledAt: string | null;
  quantity: number;
  productSummary: string;
  refundAmount: number | null;
  pickupWaybillNo: string | null;
  attention: CustomerReturnAttention[];
}

export interface CustomerReturnListPage {
  items: CustomerReturnListItem[];
  total: number;
  attentionCount: number;
}

export interface CustomerReturnListQuery {
  bucket: CustomerReturnBucket;
  q?: string;
  limit?: number;
  offset?: number;
}

// ---- 요청 본문 (core) ----
export interface CloseCustomerReturnMissingBody {
  memo: string;
}
export interface SettleHeldCustomerReturnBody {
  deduction: number;
  memo: string;
}
export interface RequestCustomerReturnPrepayBody {
  amount?: number;
  refundMode?: 'auto' | 'manual';
  memo: string;
}
export interface RestartCustomerReturnBody {
  alreadyRefundedAmount?: number | null;
  dropHoldDeduction?: true;
}

// ---- Medusa (snake_case, 감싸기 없음) ----
export type ReturnRejectReason =
  | 'order_canceled'
  | 'item_not_in_order'
  | 'not_delivered'
  | 'quantity_exceeds_returnable'
  | 'window_closed'
  | 'window_override_reason_required'
  | 'reason_not_found'
  | 'reason_not_selectable'
  | 'fee_bearer_required'
  | 'request_id_conflict'
  | 'return_option_missing'
  | 'return_already_received'
  | 'not_our_return'
  | 'return_arrived'
  | 'return_prepaid'
  | 'return_picked_up'
  | 'exchange_requires_seller_fault'
  | 'exchange_released';

export interface OrderReturnable {
  items: Array<{
    item_id: string;
    returnable_quantity: number;
    window_ends_at: string | null;
  }>;
}

export interface RequestOrderReturnBody {
  request_id: string;
  items: Array<{ item_id: string; quantity: number }>;
  reason: CustomerReturnReason;
  note?: string;
  /** 사유 other 에만 쓰인다 */
  fee_bearer?: 'customer' | 'seller';
  window_override_reason?: string;
}

export interface RequestOrderReturnResult {
  return_id: string;
  request_id: string;
  status: string;
  items: Array<{ item_id: string; quantity: number }>;
  fee_bearer: string;
  window_overridden: boolean;
}

export interface CancelOrderReturnResult {
  return_id: string;
  status: string;
}

export interface ReturnSettlementPreview {
  itemValue: number;
  feeEstimate: ReturnSettlementDeduction;
  defaultPrepayAmount: number;
  prepaidAmount: number;
}
