"use server"

import { api } from "@lib/api/api"

// ── Tracking types ────────────────────────────────────────────────────────

export interface StoreTrackingEvent {
  status: string
  location: string | null
  timestamp: string
}

export interface StoreShipment {
  fulfillmentOrderId: string
  carrier: string
  carrierName: string
  trackingNumber: string
  trackingUrl: string | null
  status: string
  shippedAt: string | null
  deliveredAt: string | null
  eta: string | null
  trackingEvents: StoreTrackingEvent[]
}

export interface StoreOrderTrackingResponse {
  orderId: string
  channelOrderId: string
  status: "not_shipped" | "preparing" | "shipping" | "delivered"
  shipments: StoreShipment[]
}

export type StoreOrderAction = "cancel" | "track" | "return" | "exchange" | "receipt"

export type StoreFulfillmentStatus =
  | "not_created"
  | "awaiting_matching"
  | "created"
  | "picking"
  | "packed"
  | "shipped"
  | "delivered"
  | "canceled"

export type StoreRefundStatus =
  | "none"
  | "pending"
  | "manual_pending"
  | "succeeded"
  | "failed"

export type StoreCancelUnavailableReason =
  | "already_shipped"
  | "already_cancelled"
  | "channel_order"
  | "already_processing"

export type StoreClaimStatus =
  | "none"
  | "return_requested"
  | "exchange_requested"
  | "returning"
  | "completed"

export interface RefundSummary {
  status: StoreRefundStatus
  amount: number | null
  currency: string
  paymentMethodLabel: string | null
  manualRequired: boolean
  expectedProcessingMessage: string | null
  lastUpdatedAt: string | null
}

export interface StoreOrderActionsResponse {
  orderId: string
  channelOrderId: string
  orderStatus: string
  fulfillmentStatus: StoreFulfillmentStatus
  refundStatus: StoreRefundStatus
  claimStatus: StoreClaimStatus
  availableActions: StoreOrderAction[]
  cancelUnavailableReason?: StoreCancelUnavailableReason
  /** 결제 상태. 무통장입금 미확인 시 'awaiting_payment', 확인 완료 시 'paid'. */
  paymentStatus?: 'paid' | 'awaiting_payment'
  refundSummary?: RefundSummary
  channelInfo?: {
    channel: string
    cancelUrl?: string
    returnUrl?: string
  }
}

export interface StoreCancelOrderRequest {
  reasonCode?: "CHANGE_OF_MIND" | "WRONG_ORDER" | "FOUND_CHEAPER" | "DELAY" | "OTHER"
  reasonDetail?: string
}

/** Medusa order ID 기반 — 스토어프론트에서 주로 사용 */
export async function getOrderActionsByMedusaId(
  medusaOrderId: string
): Promise<StoreOrderActionsResponse> {
  return api<StoreOrderActionsResponse>(
    "wms",
    `/store/orders/by-channel-order/${encodeURIComponent(medusaOrderId)}/actions`,
    { method: "GET", withAuth: true }
  )
}

/** Medusa order ID 기반 취소 — 스토어프론트에서 주로 사용 */
export async function cancelOrderByMedusaId(
  medusaOrderId: string,
  dto?: StoreCancelOrderRequest
): Promise<StoreOrderActionsResponse> {
  return api<StoreOrderActionsResponse>(
    "wms",
    `/store/orders/by-channel-order/${encodeURIComponent(medusaOrderId)}/cancel-request`,
    { method: "POST", body: dto ?? {}, withAuth: true }
  )
}

/** Core SO UUID 기반 (필요 시 사용) */
export async function getOrderActions(
  coreOrderId: string
): Promise<StoreOrderActionsResponse> {
  return api<StoreOrderActionsResponse>(
    "wms",
    `/store/orders/${encodeURIComponent(coreOrderId)}/actions`,
    { method: "GET", withAuth: true }
  )
}

// ── Order lines ───────────────────────────────────────────────────────────

export interface StoreOrderLine {
  id: string
  productName: string
  quantity: number
  unitPrice: number | null
  totalPrice: number | null
  variantId: string
}

export interface StoreOrderLinesResponse {
  orderId: string
  channelOrderId: string
  orderStatus: string
  lines: StoreOrderLine[]
}

export async function getOrderLinesByMedusaId(
  medusaOrderId: string
): Promise<StoreOrderLinesResponse> {
  return api<StoreOrderLinesResponse>(
    "wms",
    `/store/orders/by-channel-order/${encodeURIComponent(medusaOrderId)}/lines`,
    { method: "GET", withAuth: true }
  )
}

// ── Return / Exchange request ──────────────────────────────────────────────

export type ReturnReasonCode =
  | "defective"
  | "not_as_described"
  | "change_of_mind"
  | "wrong_item"
  | "damaged_in_shipping"
  | "other"

export type ExchangeReasonCode = ReturnReasonCode

export interface CreateReturnRequestLineDto {
  salesOrderLineId: string
  quantity: number
  reasonCode?: string
}

export interface CreateReturnRequestDto {
  lines: CreateReturnRequestLineDto[]
  reasonCode: ReturnReasonCode
  reasonDetail?: string
  returnAddress?: object
}

export interface CreateExchangeRequestLineDto {
  salesOrderLineId: string
  quantity: number
  desiredVariantId?: string
}

export interface CreateExchangeRequestDto {
  lines: CreateExchangeRequestLineDto[]
  reasonCode: ExchangeReasonCode
  reasonDetail?: string
}

export interface ClaimRequestItemResponse {
  salesOrderLineId: string
  quantity: number
}

export interface ReturnRequestResponse {
  id: string
  salesOrderId: string
  status: string
  reasonCode: ReturnReasonCode
  reasonDetail?: string
  items: ClaimRequestItemResponse[]
  createdAt: string
}

export interface ExchangeRequestResponse {
  id: string
  salesOrderId: string
  status: string
  reasonCode: ExchangeReasonCode
  reasonDetail?: string
  items: ClaimRequestItemResponse[]
  createdAt: string
}

export async function createReturnRequestByMedusaId(
  medusaOrderId: string,
  dto: CreateReturnRequestDto
): Promise<ReturnRequestResponse> {
  return api<ReturnRequestResponse>(
    "wms",
    `/store/orders/by-channel-order/${encodeURIComponent(medusaOrderId)}/return-requests`,
    { method: "POST", body: dto, withAuth: true }
  )
}

export async function createExchangeRequestByMedusaId(
  medusaOrderId: string,
  dto: CreateExchangeRequestDto
): Promise<ExchangeRequestResponse> {
  return api<ExchangeRequestResponse>(
    "wms",
    `/store/orders/by-channel-order/${encodeURIComponent(medusaOrderId)}/exchange-requests`,
    { method: "POST", body: dto, withAuth: true }
  )
}

// ── Tracking ──────────────────────────────────────────────────────────────

/** Medusa order ID 기반 배송조회 — 스토어프론트에서 주로 사용 */
export async function getOrderTrackingByMedusaId(
  medusaOrderId: string
): Promise<StoreOrderTrackingResponse> {
  return api<StoreOrderTrackingResponse>(
    "wms",
    `/store/orders/by-channel-order/${encodeURIComponent(medusaOrderId)}/tracking`,
    { method: "GET", withAuth: true }
  )
}
