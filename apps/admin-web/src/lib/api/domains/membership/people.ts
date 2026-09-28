'use client';

import { MEMBERSHIP_SERVICE_BASE_URL } from '@/const';
import { client } from '../../client';
import type { AdminMemberListItem } from './index';

// 관리자 운영 mutation 멱등 키 — 호출마다 새 키. 더블클릭은 버튼 비활성으로 막는다.
const idemConfig = () => ({
  headers: { 'Idempotency-Key': crypto.randomUUID() },
});

/** 회원을 «사람» 기준으로 나누는 축. 서버 `MEMBER_AXES` 와 같은 값이다. */
export type MemberAxis = 'arrears' | 'past_due' | 'good' | 'ending';
export const MEMBER_AXES: readonly MemberAxis[] = [
  'arrears',
  'past_due',
  'good',
  'ending',
];

export interface GoodCustomerCriteria {
  minTenureDays: number;
  minPaidDays: number;
  failureLookbackMonths: number;
  topShare: number;
}

/** 사람 축 요약. 각 숫자는 같은 축 목록의 total 과 같은 정의로 센다. */
export interface MembershipInsights {
  asOf: string;
  monthStart: string;
  arrears: {
    outstandingAmount: number;
    outstandingPeople: number;
    outstandingLines: number;
    oldestOutstandingAt: string | null;
    thisMonth: {
      createdAmount: number;
      createdLines: number;
      settledAmount: number;
      waivedAmount: number;
    };
    lifetime: {
      settledAmount: number;
      waivedAmount: number;
      outstandingAmount: number;
    };
    recentMismatches: number;
  };
  pastDue: { people: number; lastChance: number; amountAtRisk: number };
  good: {
    people: number;
    activePeople: number;
    undeterminedPeople: number;
    paidAmount: number;
    allPaidAmount: number;
    criteria: GoodCustomerCriteria;
  };
  ending: { people: number; endingWithin7Days: number };
}

export interface ArrearsAxisDetail {
  outstandingAmount: number;
  lines: number;
  oldestAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  causes: string[];
  paymentInProgress: boolean;
  benefit: {
    discountAmount: number;
    discountOrders: number;
    welcomeDeal: boolean;
    unmeasuredLines: number;
  };
  recentMismatches: number;
}

export interface PastDueAxisDetail {
  source: 'INVOICE' | 'LEGACY';
  failedAttempts: number;
  maxAttempts: number;
  remainingAttempts: number;
  lastFailedAt: string | null;
  lastErrorCode: string | null;
  nextRetryAt: string | null;
  amount: number;
}

export interface GoodAxisDetail {
  paidAmount: number;
  paidCount: number;
  paidDays: number;
  firstPaidAt: string;
  isTopPayer: boolean;
}

export interface EndingAxisDetail {
  endsAt: string | null;
  recurringCancelledAt: string | null;
}

export interface AxisDetailByAxis {
  arrears: ArrearsAxisDetail;
  past_due: PastDueAxisDetail;
  good: GoodAxisDetail;
  ending: EndingAxisDetail;
}

export type AxisMemberRow<A extends MemberAxis> = AdminMemberListItem & {
  axisDetail: AxisDetailByAxis[A];
};

export interface AxisMembersResponse<A extends MemberAxis> {
  data: AxisMemberRow<A>[];
  total: number;
  page: number;
  limit: number;
  axis: A;
}

export interface AxisMembersQuery {
  page: number;
  limit: number;
  userIds?: string[];
}

/** 미납 원장 한 줄 */
export interface ArrearsItem {
  id: string;
  userId: string;
  contractId: string;
  invoiceRef: string;
  /** 'UNCOLLECTIBLE'(출금 재시도 소진) | 'MANDATE_REJECTED'(계좌 심사 거절·기한초과) */
  cause: string;
  causeCode: string | null;
  amount: number;
  currency: string;
  /** 'INVOICE' | 'PLAN_FALLBACK' | 'ADMIN_ADJUSTED' */
  amountSource: string;
  periodStart: string | null;
  periodEnd: string | null;
  /** 'OUTSTANDING' | 'SETTLED' | 'WAIVED' */
  status: string;
  settlementRef: string | null;
  settledAt: string | null;
  settledBy: string | null;
  createdAt: string;
}

export interface ArrearsAdjustmentItem {
  id: string;
  arrearsId: string;
  /** 'WAIVE' | 'ADJUST_AMOUNT' */
  action: string;
  amountBefore: number;
  amountAfter: number;
  reason: string;
  adminId: string;
  createdAt: string;
}

export interface ArrearsLineBenefit {
  arrearsId: string;
  measurable: boolean;
  discountAmount: number;
  discountOrders: number;
  welcomeDeal: boolean;
}

export interface ArrearsTimelineEvent {
  id: number;
  contractId: string;
  eventType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface MemberArrears {
  outstanding: { total: number; count: number; currency: string };
  items: ArrearsItem[];
  /** 과도기(membership 이 옛 버전)엔 없다 — 화면은 빈 목록으로 본다. */
  adjustments?: ArrearsAdjustmentItem[];
  benefits?: ArrearsLineBenefit[];
  events?: ArrearsTimelineEvent[];
}

export const membershipPeopleApi = {
  getInsights: async (): Promise<MembershipInsights> => {
    const res = await client.get<MembershipInsights>(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/members/insights`
    );
    return res.data;
  },

  getMembersByAxis: async <A extends MemberAxis>(
    axis: A,
    query: AxisMembersQuery
  ): Promise<AxisMembersResponse<A>> => {
    const params = new URLSearchParams({
      axis,
      page: String(query.page),
      limit: String(query.limit),
    });
    for (const id of query.userIds ?? []) params.append('userIds', id);
    const res = await client.get<AxisMembersResponse<A>>(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/members?${params.toString()}`
    );
    return res.data;
  },

  getMemberArrears: async (userId: string): Promise<MemberArrears> => {
    const res = await client.get<MemberArrears>(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/arrears/${encodeURIComponent(userId)}`
    );
    return res.data;
  },

  waiveArrears: async (
    arrearsId: string,
    reason: string
  ): Promise<{ arrearsId: string; status: string }> => {
    const res = await client.post<{ arrearsId: string; status: string }>(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/arrears/${encodeURIComponent(arrearsId)}/waive`,
      { reason },
      idemConfig()
    );
    return res.data;
  },

  adjustArrearsAmount: async (
    arrearsId: string,
    amount: number,
    reason: string
  ): Promise<{ arrearsId: string; amount: number }> => {
    const res = await client.patch<{ arrearsId: string; amount: number }>(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/arrears/${encodeURIComponent(arrearsId)}/amount`,
      { amount, reason },
      idemConfig()
    );
    return res.data;
  },
};
