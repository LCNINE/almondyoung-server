'use client';

import { MEMBERSHIP_SERVICE_BASE_URL } from '@/const';
import { AdminRecurringContractSummary } from '@/lib/types/dto/membership';
import { client } from '../../client';

// 관리자 운영 mutation 멱등 키. 호출마다 새 키를 발급한다 — axios 자동 재시도는 같은 config(=같은 키)를
// 재사용하므로 타임아웃 후 재시도를 서버가 흡수하고, 더블클릭은 버튼 비활성으로 막힌다.
const idemConfig = () => ({ headers: { 'Idempotency-Key': crypto.randomUUID() } });

export interface AdminMembersQuery {
  page?: number;
  limit?: number;
  /** ACTIVE | PAUSED | CANCELLED | EXPIRED */
  status?: string;
  /** userId partial search */
  q?: string;
  /** filter by resolved userIds (from user-service lookup) */
  userIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  dateCriteria?: 'createdAt' | 'cancelledAt';
  /** 환불 요청은 있는데 아직 돈이 안 나간 건만 */
  refundPending?: boolean;
}

export interface AdminMemberListItem {
  contractId: string;
  userId: string;
  /** Computed: ACTIVE | PAUSED | CANCELLED | EXPIRED */
  status: string;
  tierCode: string;
  tierPriority: number;
  planDurationDays: number;
  billingDate: string;
  nextBillingDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  isPaused: boolean;
  pausedAt: string | null;
  createdAt: string;
  cancelledAt: string | null;
  autoRenewal: boolean;
  cancellationReasonCode: string | null;
  recurringCancellationReasonCode: string | null;
  /** 백엔드가 취소 사유 코드를 마스터 displayText로 해석한 값(없으면 null) */
  cancellationReasonText: string | null;
  /** 해지 예약 시각. 있으면 잔여기간 이용 중인 '예약 해지'. 과도기엔 undefined. */
  recurringCancelledAt?: string | null;
  refundRequested?: boolean;
  refundCompleted?: boolean;
  refundCompletedAt?: string | null;
  eligibleRefundAmount?: number | null;
  hasPaymentIntent?: boolean;
  billingPath?: string;
  /** 서버가 확정한 종료 사실(경로·상태·사유). 해지된 적이 없으면 null, 과도기엔 undefined. */
  cancellation?: CancellationInfoDto | null;
}

/** 계약이 어떻게 끝났는지 — 경로(누가 왜)와 상태(지금 어떤가)는 다른 축이다. */
export interface CancellationInfoDto {
  origin:
    | 'CUSTOMER_IMMEDIATE'
    | 'CUSTOMER_SCHEDULED'
    | 'ADMIN_FORCED'
    | 'ADMIN_SCHEDULED'
    | 'PAYMENT_FAILED'
    | 'MANDATE_REJECTED'
    | 'REFUND_VOIDED'
    | 'NATURAL_EXPIRY';
  originLabel: string;
  state: 'SCHEDULED_ACTIVE' | 'ENDED';
  stateLabel: string;
  requestedAt: string | null;
  endedAt: string | null;
  endsAt: string | null;
  reasonLabel: string | null;
  reasonDetail: string | null;
  customerNotice: string | null;
}

export interface AdminMembersResponse {
  data: AdminMemberListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminMemberDetail {
  contractId: string;
  userId: string;
  status: string;
  tierCode: string;
  tierPriority: number;
  planId: string;
  planDurationDays: number;
  billingDate: string;
  nextBillingDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  isPaused: boolean;
  pausedAt: string | null;
  createdAt: string;
  cancelledAt: string | null;
  autoRenewal: boolean;
  /** 정기결제 해지 예약 시점 (status 는 ACTIVE 를 유지한다) */
  recurringCancelledAt: string | null;
  recurringCancellationReasonCode: string | null;
  refundRequested: boolean;
  refundRequestedAt: string | null;
  eligibleRefundAmount: number | null;
  refundCompleted: boolean;
  refundCompletedAt: string | null;
  /** 해지 예약을 철회해 자동결제를 재개할 수 있는지(서버 판정). 1회 결제 계약은 false. */
  canUndoCancellation: boolean;
  /** 계좌 송금이 남은 환불 건의 수취 계좌. 이게 없으면 관리자가 어디로 보낼지 알 수 없다. */
  manualRefundAccount: {
    bank: string;
    accountNumber: string;
    holderName: string;
  } | null;
  /**
   * 환불 대상 결제 내역이 있는지. 관리자 지급·이관 계약은 결제가 없어 환불 자체가 불가능하다.
   *
   * optional 인 이유는 배포 과도기다 — admin-web 이 membership 보다 먼저 뜨면 이 필드가 없다.
   * 타입이 그 사실을 말해줘야 화면이 `!hasPaymentIntent` 같은 판정으로 뒤집히지 않는다.
   */
  hasPaymentIntent?: boolean;
  /**
   * 미완료 환불 건의 결제관리(wallet) 쪽 사실. 계좌로 송금하기 **전에** 확인해야 하는 값이다 —
   * 이미 PG 로 나갔거나 결제관리가 확정만 남긴 건에 또 보내면 돈이 두 번 나간다.
   * 과도기·조회 실패에는 없거나 null 이다(= 알 수 없음, 아무것도 단정하지 않는다).
   */
  refundSettlement?: {
    alreadyRefundedAmount: number;
    pendingRefundAmount: number;
  } | null;
  pauseCount: number;
  firstContractCreatedAt: string;
}

export interface BillingEventItem {
  id: string;
  contractId: string;
  eventType: string;
  attemptNo: number | null;
  amount: number | null;
  paymentIntentId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface ContractEventItem {
  id: number;
  contractId: string;
  eventType: string;
  userId: string;
  causedBy: string;
  causedByUserId: string | null;
  createdAt: string;
}

export interface AdminTier {
  id: string;
  code: string;
  priorityLevel: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPlan {
  id: string;
  tierId: string;
  price: number;
  durationDays: number;
  currency: string;
  trialDays: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTierWithPlans {
  tier: AdminTier;
  plans: AdminPlan[];
}

export interface AdminBillingHistoryQuery {
  page?: number;
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
  contractId?: string;
  userId?: string;
  eventType?: string;
}

export interface AdminBillingHistoryItem {
  id: string;
  contractId: string;
  userId: string;
  eventType: string;
  attemptNo: number | null;
  amount: number | null;
  paymentIntentId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface AdminBillingHistoryResponse {
  data: AdminBillingHistoryItem[];
  total: number;
  page: number;
  limit: number;
}

function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((v) => params.append(key, String(v)));
    } else {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

/** 해지·환불 견적 (membership `/admin/subscriptions/:id/cancellation-quote`) */
export interface AdminCancellationOption {
  mode: 'AT_PERIOD_END' | 'IMMEDIATE_REFUND';
  available: boolean;
  unavailableReason?: string;
  refundAmount: number;
  refundKind:
    | 'NONE'
    | 'WITHDRAWAL_FULL'
    | 'ANNUAL_PRORATION'
    /** 효성 CMS 선지급 — 아직 출금 전이라 청구 없이 종료된다(돌려줄 돈 자체가 없다) */
    | 'PRE_COLLECTION_WITHDRAWAL';
  refundExecution: 'NONE' | 'AUTO' | 'MANUAL';
  requiresReceiveAccount: boolean;
  effectiveEndsAt: string;
  breakdown?: {
    paidAmount: number;
    monthlyListPrice: number;
    monthsElapsed: number;
    usageDeduction: number;
    benefitDeduction: number;
  };
}

export interface AdminCancellationQuote {
  contractId: string;
  planName: { durationDays: number; price: number };
  isRecurring: boolean;
  alreadyScheduledForCancellation: boolean;
  recurringCancelledAt: string | null;
  currentPeriodEndsAt: string;
  nextBillingDate: string | null;
  recommendedMode: 'AT_PERIOD_END' | 'IMMEDIATE_REFUND';
  withdrawalDaysRemaining: number;
  withdrawalWindowDays: number;
  refundProcessingBusinessDays: number;
  /**
   * 환불 대상 결제 내역이 있는지. false 면 서버가 환불 유형을 400 으로 거부하므로 화면도 열지 않는다.
   * 과도기(membership 이 옛 버전)엔 undefined — 그때는 서버 판정에 맡긴다.
   */
  hasPaymentIntent?: boolean;
  options: AdminCancellationOption[];
}

export const membershipApi = {
  getAdminMembers: async (
    query: AdminMembersQuery
  ): Promise<AdminMembersResponse> => {
    const qs = buildQueryString(query as Record<string, unknown>);
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/members${qs ? `?${qs}` : ''}`
    );
    return res.data;
  },

  getMemberDetail: async (userId: string): Promise<AdminMemberDetail> => {
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/members/${encodeURIComponent(userId)}`
    );
    return res.data;
  },

  getMemberBillingEvents: async (
    userId: string
  ): Promise<BillingEventItem[]> => {
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/billing-events?userId=${encodeURIComponent(userId)}`
    );
    return res.data;
  },

  getMemberContractEvents: async (
    userId: string
  ): Promise<ContractEventItem[]> => {
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/contract-events?userId=${encodeURIComponent(userId)}`
    );
    return res.data;
  },

  setAutoRenewal: async (
    contractId: string,
    autoRenewal: boolean
  ): Promise<void> => {
    await client.put(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/contracts/${encodeURIComponent(contractId)}/auto-renewal`,
      { autoRenewal },
      idemConfig()
    );
  },

  /**
   * 해지 예약 (관리자 대행). 고객 셀프해지의 '해지 예약' 과 같은 처리다.
   * auto-renewal 토글은 청구만 멈추고 해지 사유·해지 시각·자동이체 약정 종료가 빠진다.
   */
  scheduleCancelSubscription: async (
    contractId: string,
    body: { reason: string; customerEmail?: string; deleteBillingMethod?: boolean }
  ): Promise<{ currentPeriodEndsAt: string; message: string }> => {
    const res = await client.post(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/subscriptions/${encodeURIComponent(contractId)}/schedule-cancel`,
      body,
      idemConfig()
    );
    return res.data;
  },

  /**
   * 수동 송금 환불 완료 처리. 효성 CMS 환불은 wallet 에 환불 행이 없어 결제관리에서 닫을 수 없다.
   */
  completeManualRefund: async (
    contractId: string,
    body: { amount?: number; memo?: string }
  ): Promise<{ contractId: string; refundedAmount: number }> => {
    const res = await client.post(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/subscriptions/${encodeURIComponent(contractId)}/refund/manual-complete`,
      body,
      idemConfig()
    );
    return res.data;
  },

  adjustEntitlement: async (
    userId: string,
    days: number,
    reason: string
  ): Promise<void> => {
    await client.post(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/entitlements/adjust`,
      {
        userId,
        days,
        reason,
      },
      idemConfig()
    );
  },

  getAllTiersWithPlans: async (): Promise<AdminTierWithPlans[]> => {
    const res = await client.get(`${MEMBERSHIP_SERVICE_BASE_URL}/admin/tiers`);
    return res.data;
  },

  createTier: async (body: {
    code: string;
    priorityLevel: number;
  }): Promise<void> => {
    await client.post(`${MEMBERSHIP_SERVICE_BASE_URL}/admin/tiers`, body);
  },

  updateTier: async (
    tierId: string,
    body: { priorityLevel?: number }
  ): Promise<void> => {
    await client.put(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/tiers/${encodeURIComponent(tierId)}`,
      body
    );
  },

  createPlan: async (body: {
    tierId: string;
    price: number;
    durationDays: number;
    currency?: string;
    trialDays?: number;
  }): Promise<void> => {
    await client.post(`${MEMBERSHIP_SERVICE_BASE_URL}/admin/plans`, body);
  },

  updatePlan: async (
    planId: string,
    body: {
      price?: number;
      durationDays?: number;
      trialDays?: number;
    }
  ): Promise<void> => {
    await client.put(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/plans/${encodeURIComponent(planId)}`,
      body
    );
  },

  deactivatePlan: async (planId: string, reason: string): Promise<void> => {
    await client.delete(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/plans/${encodeURIComponent(planId)}`,
      {
        data: { reason },
      }
    );
  },

  getAllBillingHistory: async (
    query: AdminBillingHistoryQuery
  ): Promise<AdminBillingHistoryResponse> => {
    const qs = buildQueryString(query as Record<string, unknown>);
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/billing-history${qs ? `?${qs}` : ''}`
    );
    return res.data;
  },

  /**
   * 해지·환불 견적. 정책상 환불 금액과 산출 내역, 실제 환불 가능 수단을 반환한다.
   * 관리자가 금액을 손으로 짐작하지 않게 하는 계산기.
   */
  getCancellationQuote: async (contractId: string): Promise<AdminCancellationQuote> => {
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/subscriptions/${encodeURIComponent(contractId)}/cancellation-quote`
    );
    return res.data;
  },

  forceCancelSubscription: async (
    contractId: string,
    body: {
      reason: string;
      refundType: 'FULL' | 'PARTIAL' | 'NONE';
      refundAmount?: number;
      adminNote?: string;
      /** 해지 안내 메일 수신 주소 (membership 은 사용자 조회를 하지 않아 여기서 넘겨야 한다) */
      customerEmail?: string;
      refundReceiveAccount?: { bank: string; accountNumber: string; holderName: string };
      /** 등록된 자동이체 계좌까지 지울지. 생략하면 남긴다(재가입 시 은행 재심사 불필요). */
      deleteBillingMethod?: boolean;
    }
  ): Promise<{
    refundAmount: number;
    refundStatus: 'COMPLETED' | 'FAILED' | 'PENDING' | 'NOT_APPLICABLE';
  }> => {
    const res = await client.post(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/subscriptions/${encodeURIComponent(contractId)}/force-cancel`,
      body,
      idemConfig()
    );
    return res.data;
  },

  activatePlan: async (planId: string): Promise<void> => {
    await client.patch(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/plans/${encodeURIComponent(planId)}/activate`
    );
  },

  adminSubscribeUser: async (body: {
    userId: string;
    planId: string;
    billingMode: 'one_time' | 'recurring';
  }): Promise<{ contractId: string; entitlementId: string }> => {
    const res = await client.post(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/members/subscribe`,
      body
    );
    return res.data;
  },

  retryBilling: async (
    contractId: string
  ): Promise<{ contractId: string; success: boolean; errorCode?: string; errorMessage?: string }> => {
    const res = await client.post(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/billing/retry/${encodeURIComponent(contractId)}`,
      null,
      idemConfig()
    );
    return res.data;
  },

  // INVOICE 계약 강제 정합화 — wallet 인보이스 권위 상태를 즉시 되물어 구독(자격)↔인보이스(결제) 발산 해소.
  reconcileInvoice: async (
    contractId: string
  ): Promise<{ contractId: string; periodStart: string; invoiceStatus: string | null }> => {
    const res = await client.post(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/billing/reconcile-invoice/${encodeURIComponent(contractId)}`,
      null
    );
    return res.data?.data ?? res.data;
  },

  grantSubscriptionByDays: async (
    userId: string,
    days: number,
    memo?: string
  ): Promise<void> => {
    await client.post(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/members/${encodeURIComponent(userId)}/grant`,
      {
        days,
        memo,
      },
      idemConfig()
    );
  },

  getRecurringContractsByIds: async (
    contractIds: string[]
  ): Promise<AdminRecurringContractSummary[]> => {
    if (!contractIds.length) return [];
    const params = new URLSearchParams();
    contractIds.forEach((id) => params.append('contractId', id));
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/recurring-contracts/by-ids?${params.toString()}`
    );
    return res.data;
  },

  getRecurringContracts: async (query: {
    page?: number;
    limit?: number;
    userId?: string;
    contractId?: string;
    status?: string;
    dateType?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<
    import('@/lib/types/dto/membership').AdminRecurringContractsResponse
  > => {
    const params = new URLSearchParams();
    if (query.page) params.set('page', String(query.page));
    if (query.limit) params.set('limit', String(query.limit));
    if (query.userId) params.set('userId', query.userId);
    if (query.contractId) params.set('contractId', query.contractId);
    if (query.status) params.set('status', query.status);
    if (query.dateType) params.set('dateType', query.dateType);
    if (query.dateFrom) params.set('dateFrom', query.dateFrom);
    if (query.dateTo) params.set('dateTo', query.dateTo);
    const qs = params.toString();
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/recurring-contracts${qs ? `?${qs}` : ''}`
    );
    return res.data;
  },

  getStuckBillingContracts: async (
    thresholdHours = 48
  ): Promise<
    import('@/lib/types/dto/membership').StuckBillingContractsResponse
  > => {
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/stuck-billing-contracts?thresholdHours=${thresholdHours}`
    );
    return res.data;
  },

  getDunningList: async (): Promise<
    import('@/lib/types/dto/membership').DunningListResponse
  > => {
    const res = await client.get(`${MEMBERSHIP_SERVICE_BASE_URL}/admin/dunning`);
    return res.data;
  },

  /** 해지했는데 은행에 자동이체 약정이 남은 계약. 로그에만 있던 ABANDONED 를 사람이 보게 한다. */
  getAgreementCleanupQueue: async (): Promise<
    import('@/lib/types/dto/membership').AgreementCleanupListResponse
  > => {
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/agreement-cleanup`
    );
    return res.data;
  },

  resetBillingInProgress: async (
    contractId: string,
    reason: string
  ): Promise<{ contractId: string; reset: boolean }> => {
    const res = await client.post(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/contracts/${encodeURIComponent(contractId)}/reset-billing-progress`,
      { reason }
    );
    return res.data;
  },
};
