export interface AdminRecurringContractSummary {
  contractId: string;
  userId: string;
  status: string;
  planId: string;
  tierCode: string;
  planDurationDays: number;
  autoRenewal: boolean;
  nextBillingDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  lastPaymentIntentId: string | null;
}

export interface AdminRecurringContractListItem {
  contractId: string;
  userId: string;
  status: string;
  tierCode: string;
  planDurationDays: number;
  autoRenewal: boolean;
  nextBillingDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  lastPaymentIntentId: string | null;
  billingInProgress: boolean;
  billingStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminRecurringContractsResponse {
  data: AdminRecurringContractListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface StuckBillingContractItem {
  contractId: string;
  userId: string;
  planId: string;
  nextBillingDate: string | null;
  billingInProgressSince: string;
  hoursElapsed: number;
}

export interface StuckBillingContractsResponse {
  data: StuckBillingContractItem[];
  total: number;
}

/**
 * 해지가 끝났는데 은행에 효성 자동이체 약정이 남아 있는 계약.
 * ABANDONED 는 스케줄러가 재시도를 멈춘 건이라 사람이 처리하지 않으면 영원히 그대로다.
 */
export interface AgreementCleanupItem {
  contractId: string;
  userId: string;
  state:
    | 'AGREEMENT_REVOKE_ABANDONED'
    | 'AGREEMENT_REVOKE_PENDING'
    | 'AGREEMENT_REVOKE_DEFERRED';
  since: string;
  /** DEFERRED 가 정리 대상이 되는 날(이용 종료일). 그 외엔 null */
  notBefore: string | null;
  /** 정리가 막힌 사유(효성 삭제 가드 등) */
  reason: string | null;
  contractStatus: string | null;
  billingPath: string | null;
  cancelledAt: string | null;
}

export interface AgreementCleanupListResponse {
  data: AgreementCleanupItem[];
  total: number;
}

export interface DunningListItem {
  contractId: string;
  userId: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
}

export interface DunningListResponse {
  data: DunningListItem[];
  total: number;
}

export interface AgreementStateEntry {
  billingAgreementId: string;
  billingMethodId: string;
  providerType: string;
  cmsMemberId: string | null;
  cmsMemberRowId: string | null;
  cmsMemberStatus: string | null;
  agreementStatus: string | null;
}
