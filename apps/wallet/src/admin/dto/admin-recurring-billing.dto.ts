import { PaginationQueryDto } from '@app/shared';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class AdminRecurringBillingListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(['needs-action', 'members', 'withdrawals', 'contracts'])
  view?: 'needs-action' | 'members' | 'withdrawals' | 'contracts';

  @IsOptional()
  @IsEnum(['updatedAt', 'createdAt', 'paymentDate'])
  dateType?: 'updatedAt' | 'createdAt' | 'paymentDate';

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  @IsEnum(['PENDING', 'REGISTERED', 'FAILED', 'DELETED'])
  cmsMemberStatus?: 'PENDING' | 'REGISTERED' | 'FAILED' | 'DELETED';

  @IsOptional()
  @IsEnum(['REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'DELETED'])
  withdrawalStatus?: 'REQUESTED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'DELETED';

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  contractId?: string;

  @IsOptional()
  @IsString()
  cmsMemberId?: string;

  @IsOptional()
  @IsString()
  transactionId?: string;

  @IsOptional()
  @IsString()
  paymentIntentId?: string;

  @IsOptional()
  @IsEnum(['CMS_BATCH', 'TOSS_BILLING', 'NICEPAY_BILLING'])
  providerType?: 'CMS_BATCH' | 'TOSS_BILLING' | 'NICEPAY_BILLING';
}

export class AdminRecurringBillingOverviewDto {
  needsAction: number;
  memberPending: number;
  memberFailed: number;
  withdrawalRequested: number;
  settlementPending: number;
  withdrawalFailed: number;
}

export type AdminRecurringBillingIssueType =
  | 'PROVIDER_METHOD'
  | 'PROVIDER_MANDATE'
  | 'PROVIDER_CHARGE'
  | 'PAYMENT_INTENT'
  | 'CONTRACT';

export class AdminRecurringBillingRowDto {
  issueType: AdminRecurringBillingIssueType;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  needsAction: boolean;
  userId: string;
  providerType: string;
  billingMethodId?: string;
  billingAgreementId?: string;
  subscriberRef?: string;
  subscriberType?: string;
  amount?: number;
  actualAmount?: number | null;
  paymentIntentId?: string;
  paymentIntentStatus?: string;
  chargeId?: string;
  chargeStatus?: string;
  providerState?: {
    cmsMemberId?: string;
    cmsMemberRowId?: string;
    cmsMemberStatus?: 'PENDING' | 'REGISTERED' | 'FAILED' | 'DELETED';
    agreementStatus?: string | null;
    withdrawalId?: string;
    transactionId?: string;
    withdrawalStatus?: 'REQUESTED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'DELETED';
    paymentDate?: string;
    resultCode?: string | null;
    resultMessage?: string | null;
    rawStatus?: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

// ─── 인보이스(ADR-0027) 뷰 ────────────────────────────────────────────────────

export const ADMIN_INVOICE_STATUSES = [
  'DRAFT',
  'OPEN',
  'MANDATE_PENDING',
  'ATTEMPTING',
  'PAST_DUE',
  'PAID',
  'UNCOLLECTIBLE',
  'MANDATE_REJECTED',
  'VOID',
] as const;

export class AdminInvoiceListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ADMIN_INVOICE_STATUSES)
  status?: (typeof ADMIN_INVOICE_STATUSES)[number];

  @IsOptional()
  @IsString()
  subscriberRef?: string;

  @IsOptional()
  @IsString()
  userId?: string;
}

export class AdminInvoiceRowDto {
  id: string;
  status: (typeof ADMIN_INVOICE_STATUSES)[number];
  subscriberType: string;
  subscriberRef: string;
  userId: string | null;
  billingMethodId: string;
  billingMethodDisplayName: string | null;
  amountDue: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  finalizedAt: string | null;
  /** OPEN/MANDATE_PENDING/PAST_DUE — 관리자 수동 집행 가능 상태 */
  isExecutable: boolean;
  /** 마지막 실패/거절 사유 (invoice metadata — 재시도 실패·심사 거절 시 기록) */
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}
