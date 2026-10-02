'use client';

import { MEMBERSHIP_SERVICE_BASE_URL } from '@/const';
import { client } from '../../client';

/** 출금 실패·미납 «건» 하나. 서버 `ClassifiedCase` 와 같은 모양이다. */
export interface RecoveryCase {
  /** WITHDRAWAL = 출금이 실패한 인보이스, MANDATE = 출금 전 계좌 심사 거절로 해지 */
  kind: 'WITHDRAWAL' | 'MANDATE';
  contractId: string;
  userId: string;
  invoiceId: string | null;
  startedAt: string;
  lastFailedAt: string | null;
  attempts: number;
  /** 실패 한 번 한 번의 회차와 시각(오래된 순) */
  failures: Array<{ attemptNo: number; at: string }>;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  nextAttemptAt: string | null;
  recoveredAt: string | null;
  recoveredAmount: number | null;
  terminatedAt: string | null;
  terminatedReason: string | null;
  contractStatus: string;
  planPrice: number;
  arrears: {
    id: string;
    amount: number;
    status: 'OUTSTANDING' | 'SETTLED' | 'WAIVED';
    paying: boolean;
    createdAt: string;
    settledAt: string | null;
  } | null;
  arrearsSkippedReason: string | null;
  attemptNotices: Array<{
    attemptNo: number;
    state: 'QUEUED' | 'SKIPPED';
    reason: string | null;
  }>;
  finalNotice: { state: 'QUEUED' | 'SKIPPED'; reason: string | null } | null;
  stage:
    | 'RETRYING'
    | 'AWAITING_RESULT'
    | 'RECOVERED'
    | 'TERMINATED'
    | 'ENDED_OTHER';
  /** 미납 정책·고객 알림 시행 전에 시작된 건인가 */
  era: 'BEFORE_POLICY' | 'UNDER_POLICY';
  terminationKind: 'EXHAUSTED' | 'MANDATE_REJECTED' | 'VOIDED' | 'OTHER' | null;
  debtState:
    | 'OUTSTANDING'
    | 'PAYING'
    | 'SETTLED'
    | 'WAIVED'
    | 'NOT_RECORDED'
    | null;
  remainingAttempts: number;
  nextAttempt: { at: string; estimated: boolean } | null;
  /** 정책 시행 후 실패했는데 알림 기록이 없는 회차 */
  attemptNoticesMissing: number[];
  /** 정책 시행 전에 실패해 알림 대상이 아니었던 회차 */
  attemptNoticesBeforePolicy: number[];
  finalNoticeExpected: boolean;
}

export interface CountAmount {
  cases: number;
  amount: number;
}

export interface RecoveryFunnel {
  withdrawalFailed: CountAmount & { people: number };
  recovered: CountAmount & { amountUnknownCases: number };
  retrying: CountAmount & { lastChance: number };
  awaitingResult: CountAmount;
  endedOther: CountAmount;
  voided: CountAmount;
  exhausted: CountAmount;
  mandateRejected: CountAmount & { people: number };
  debt: {
    recorded: CountAmount;
    outstanding: CountAmount;
    paying: CountAmount;
    settled: CountAmount;
    waived: CountAmount;
    notRecorded: Record<string, number>;
  };
  notices: {
    attempt: { queued: number; skipped: number; missing: number };
    final: { queued: number; skipped: number; missing: number };
    skippedReasons: Record<string, number>;
  };
}

export interface RecoveryKpis {
  retryRecoveryRate: number | null;
  retryResolved: number;
  retryUnresolved: number;
  debtCollectionRate: number | null;
  avgDaysToRecover: number | null;
  avgDaysToSettle: number | null;
}

export interface OutstandingDebtCard {
  userId: string;
  contractId: string;
  amount: number;
  lines: number;
  oldestAt: string;
  causes: string[];
  paying: boolean;
  finalNotice: { state: 'QUEUED' | 'SKIPPED'; reason: string | null } | null;
}

export interface ResolvedCard {
  userId: string;
  how: 'RETRY' | 'SETTLED' | 'WAIVED';
  amount: number | null;
  at: string;
  since: string;
}

export interface RecoveryAlert {
  people: number;
  userIds: string[];
}

export type RecoveryAlertKey =
  | 'lastChance'
  | 'noticeSkipped'
  | 'awaitingResult'
  | 'oldDebt'
  | 'paying'
  | 'mismatch';

export interface WeeklyPoint {
  week: string;
  failedCases: number;
  recoveredCases: number;
  terminatedCases: number;
  debtCreated: number;
  debtSettled: number;
  debtWaived: number;
}

export interface BillingRecoveryOverview {
  asOf: string;
  period: { month: string; from: string; toExclusive: string };
  /** 미납 정책·고객 알림 시행 시각. null 이면 경계 없이 전부 시행 후로 본다 */
  policy: { effectiveAt: string | null };
  /** 시행 후 시작된 건 */
  funnel: RecoveryFunnel;
  kpis: RecoveryKpis;
  /** 같은 달 시행 전 시작된 건 — 없으면 null */
  beforePolicy: { funnel: RecoveryFunnel; kpis: RecoveryKpis } | null;
  cohort: { cases: RecoveryCase[]; truncated: boolean };
  now: {
    outstanding: { amount: number; people: number };
    alerts: Record<RecoveryAlertKey, RecoveryAlert>;
    lanes: {
      firstFailure: { total: number; cards: RecoveryCase[] };
      lastChance: { total: number; cards: RecoveryCase[] };
      outstanding: { total: number; cards: OutstandingDebtCard[] };
      resolved: { total: number; cards: ResolvedCard[] };
    };
    legacyRetrying: number;
  };
  trend: WeeklyPoint[];
}

export interface UserRecoveryJourney {
  userId: string;
  cases: RecoveryCase[];
}

export const membershipRecoveryApi = {
  getOverview: async (month: string): Promise<BillingRecoveryOverview> => {
    const res = await client.get<BillingRecoveryOverview>(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/billing-recovery?month=${encodeURIComponent(month)}`
    );
    return res.data;
  },

  getJourney: async (userId: string): Promise<UserRecoveryJourney> => {
    const res = await client.get<UserRecoveryJourney>(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/billing-recovery/users/${encodeURIComponent(userId)}`
    );
    return res.data;
  },
};
