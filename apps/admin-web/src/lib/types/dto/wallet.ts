// ─── Payment Intent ─────────────────────────────────────────────────────────

export interface PaymentIntentListItem {
  id: string;
  payableAmount: number;
  currency: string;
  status: string;
  userId: string | null;
  paymentMethodType: string | null;
  createdAt: string;
}

export interface PaymentIntentDetail {
  id: string;
  payableAmount: number;
  currency: string;
  status: string;
  userId: string | null;
  paymentMethodId: string | null;
  clientSecret: string;
  returnUrl: string | null;
  metadata: Record<string, unknown>;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  items: PaymentIntentItemDto[];
  orderDiscounts: OrderDiscountDto[];
  charges: ChargeDto[];
  refunds: RefundDto[];
  paymentMethod: PaymentMethodSummaryDto | null;
}

export interface PaymentIntentItemDto {
  id: string;
  lineId: string;
  name: string;
  itemType: string | null;
  unitPrice: number;
  quantity: number;
  baseAmount: number;
  itemDiscountPerUnitTotal: number;
  itemDiscountFlatTotal: number;
  payableAmount: number;
  discounts: ItemDiscountDto[];
}

export interface ItemDiscountDto {
  id: string;
  kind: string;
  amount: number;
  name: string | null;
  discountRefId: string | null;
}

export interface OrderDiscountDto {
  id: string;
  kind: string;
  amount: number;
  name: string | null;
  discountRefId: string | null;
}

// ─── Charge ─────────────────────────────────────────────────────────────────

export interface ChargeDto {
  id: string;
  intentId: string;
  paymentMethodId: string;
  amount: number;
  currency: string;
  operation: string;
  status: string;
  providerTransactionId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

// ─── Refund ─────────────────────────────────────────────────────────────────

export interface RefundDto {
  id: string;
  chargeId: string;
  intentId: string;
  status: string;
  amount: number;
  currency: string;
  reasonCode: string | null;
  reasonMessage: string | null;
  createdAt: string;
}

// ─── Payment Method ─────────────────────────────────────────────────────────

export interface PaymentMethodSummaryDto {
  id: string;
  userId: string;
  type: string;
  displayName: string | null;
  createdAt: string;
}

// ─── State Transition ───────────────────────────────────────────────────────

export interface StateTransitionDto {
  id: string;
  entityType: string;
  entityId: string;
  previousStatus: string;
  newStatus: string;
  triggeredByType: string;
  triggeredById: string | null;
  correlationId: string;
  occurredAt: string;
}

// ─── Bank Transfer ──────────────────────────────────────────────────────────

export interface PendingBankTransferDto {
  id: string;
  payableAmount: number;
  currency: string;
  userId: string | null;
  bankName: string;
  accountNumber: string;
  createdAt: string;
}

// ─── Points ─────────────────────────────────────────────────────────────────

export interface PointsBalanceDto {
  confirmed: number;
  reserved: number;
  available: number;
}

export interface PointsEventDto {
  id: string;
  userId: string;
  eventType: string;
  amount: number;
  originalEventId: string | null;
  reasonCode: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface TopPointUserDto {
  userId: string;
  balance: number;
}

// ─── Points Stats ────────────────────────────────────────────────────────────

export interface PointsStatsDto {
  totalEarned: number;
  totalRedeemed: number;
  totalCancelled: number;
  currentCirculating: number;
}

export interface BatchEarnResultDto {
  succeeded: string[];
  failed: Array<{ userId: string; reason: string }>;
}

// ─── Query & Pagination ─────────────────────────────────────────────────────

export interface PaymentIntentListQuery {
  page?: number;
  limit?: number;
  q?: string;
  status?: string;
  paymentMethodType?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: string;
  order?: string;
}

export interface RefundListQuery {
  page?: number;
  limit?: number;
  status?: string;
  intentId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
