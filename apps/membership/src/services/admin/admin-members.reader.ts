import { Injectable } from '@nestjs/common';
import { BadRequestError, ConflictError } from '@app/shared';
import { DbService } from '@app/db';
import { membershipSchema, pauseEvents } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { eq, and, or, desc, asc, ilike, gte, lte, inArray, SQL, count, isNull, isNotNull, notInArray, sql } from 'drizzle-orm';
import { endOfDay } from 'date-fns';
import { ContractEventManager } from '../subscription/contract-event.manager';
import { isAxiosError } from 'axios';
import { randomUUID } from 'crypto';
import { PaymentClientService } from '../billing/payment-client.service';
import {
  isAgreementCleanupWithdrawn,
  SubscriptionContractReader,
} from '../subscription/subscription-contract.reader';
import { CancellationInfo, resolveCancellationInfo } from '../subscription/cancellation-info';

/** 목록 필터로 허용되는 상태값. 모르는 값을 조용히 무시하면 '해지 내역' 이 '전체 회원' 이 된다. */
export const ADMIN_MEMBER_STATUS_FILTERS = [
  'ACTIVE',
  'PAUSED',
  'CANCELLED',
  'EXPIRED',
  'RECURRING_CANCELLED',
  'RECURRING_CANCELLED_ENDED',
  'CANCELLED_ANY',
] as const;

export type AdminMemberStatusFilter = (typeof ADMIN_MEMBER_STATUS_FILTERS)[number];

export interface AdminMembersQuery {
  page?: number;
  limit?: number;
  /**
   * 생략하면 전체. 해지 내역 화면은 `CANCELLED_ANY`(해지한 사람만) 를 쓴다.
   *  - `CANCELLED`                 즉시해지·강제취소로 이미 끝난 계약
   *  - `RECURRING_CANCELLED`       해지 예약(잔여기간 이용 중)
   *  - `RECURRING_CANCELLED_ENDED` 해지 예약이 이용 종료일을 지나 실제로 끝난 계약
   *  - `CANCELLED_ANY`             위 셋의 합집합
   */
  status?: AdminMemberStatusFilter;
  /** userId partial search */
  q?: string;
  /** filter by resolved userIds (from user-service lookup) */
  userIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  /** date field for range filter — only meaningful when status=CANCELLED */
  dateCriteria?: 'createdAt' | 'cancelledAt';
  /** 돈이 아직 안 나간 건만. CS 가 매일 훑어야 하는 목록이다. */
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
  /** 취소 사유 코드를 마스터 테이블 displayText로 해석한 값(없으면 null → 화면은 코드/대체 라벨로 폴백) */
  cancellationReasonText: string | null;
  /** 해지 예약 시각. 있으면 '예약 해지'(잔여기간 이용 중), 없고 cancelledAt 이 있으면 '즉시 해지'. */
  recurringCancelledAt: string | null;
  refundRequested: boolean;
  refundCompleted: boolean;
  refundCompletedAt: string | null;
  eligibleRefundAmount: number | null;
  /** 환불 대상 결제가 있는지. 관리자 지급·이관 계약은 돌려줄 돈 자체가 없다. */
  hasPaymentIntent: boolean;
  /** 효성 CMS 인보이스 경로인지. 수금이 늦어 '선지급 후 출금' 상태가 존재한다. */
  billingPath: string;
  /**
   * 이 계약이 **어떻게 끝났는지**(경로·상태·사유). 해지된 적이 없으면 null.
   * 화면이 상태 필드로 추론하면 시스템 종료가 '고객 즉시해지' 로 보인다 — 서버가 계산해 내려준다.
   */
  cancellation: CancellationInfo | null;
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
  /** 정기결제 해지 예약 시점. status=ACTIVE 를 유지하면서 자동결제만 끊긴 상태의 식별자. */
  recurringCancelledAt: string | null;
  recurringCancellationReasonCode: string | null;
  /** 환불 추적 — 환불 요청은 했는데 완료되지 않은 건을 상세에서 바로 보이게 한다. */
  refundRequested: boolean;
  refundRequestedAt: string | null;
  eligibleRefundAmount: number | null;
  refundCompleted: boolean;
  refundCompletedAt: string | null;
  /**
   * 해지 예약을 철회해 자동결제를 재개할 수 있는지. 1회 결제 계약은 되살릴 정기결제가 없어 false.
   * 화면이 `autoRenewal || recurringCancelledAt` 으로 추론하면 1회 결제 해지 건까지 철회 버튼이 열려
   * 동의 없는 정기결제로 전환된다 — 서버가 판정해 내려준다.
   */
  canUndoCancellation: boolean;
  /** 계좌 송금이 남은 환불 건의 수취 계좌(효성 CMS·자동환불 실패). 없으면 null. */
  manualRefundAccount: { bank: string; accountNumber: string; holderName: string } | null;
  /**
   * 환불 대상 결제 내역이 있는지. 관리자 무료 지급·이관 계약은 결제가 없어 **환불 자체가 불가능**하다 —
   * 화면이 이걸 모르면 "미완료 — N원 처리 필요" 를 보고 CS 가 보낼 곳을 찾아 헤맨다.
   */
  hasPaymentIntent: boolean;
  /**
   * 미완료 환불 건에 대한 wallet(결제관리) 쪽 사실. 관리자가 **계좌로 보내기 전에** 알아야 한다 —
   * PG 로 이미 나갔거나 결제관리가 확정만 남긴 건에 또 송금하면 돈이 두 번 나간다.
   * 조회 실패/대상 없음이면 null(=알 수 없음, 화면은 아무것도 단정하지 않는다).
   */
  refundSettlement: { alreadyRefundedAmount: number; pendingRefundAmount: number } | null;
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

export interface AdminRecurringContractsQuery {
  page?: number;
  limit?: number;
  userId?: string;
  contractId?: string;
  status?: string;
  dateType?: 'updatedAt' | 'createdAt' | 'nextBillingDate';
  dateFrom?: string;
  dateTo?: string;
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

/** 해지했는데 은행에 자동이체 약정이 남아 있는 계약 한 건. */
export interface AgreementCleanupItem {
  contractId: string;
  userId: string;
  /** AGREEMENT_REVOKE_ABANDONED(재시도 중단) | _PENDING(재시도 중) | _DEFERRED(수금 대기) */
  state: string;
  /** 이 상태가 된 시각 */
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

@Injectable()
export class AdminMembersReader {
  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly contractEventManager: ContractEventManager,
    private readonly paymentClientService: PaymentClientService,
    private readonly contractReader: SubscriptionContractReader,
  ) {}

  async findAllWithDetails(query: AdminMembersQuery): Promise<AdminMembersResponse> {
    const { page = 1, limit = 20, status, q, userIds, dateFrom, dateTo, dateCriteria = 'createdAt', refundPending } = query;
    const offset = (page - 1) * limit;

    // 모르는 상태값을 조용히 무시하면 조건이 통째로 빠져 '해지 내역' 화면에 전체 회원이 나온다.
    // 배포 과도기(옛 서버 + 새 화면)에 그렇게 되면 CS 가 목록을 믿을 수 없다 — 명시적으로 거부한다.
    if (status !== undefined && !ADMIN_MEMBER_STATUS_FILTERS.includes(status)) {
      throw new BadRequestError(`알 수 없는 상태 필터입니다: ${String(status)}`);
    }

    const baseConditions: SQL[] = [];

    if (q) {
      baseConditions.push(ilike(schema.subscriptionContracts.userId, `%${q}%`));
    }

    if (userIds?.length) {
      baseConditions.push(inArray(schema.subscriptionContracts.userId, userIds));
    }

    // 해지일 기준 필터는 즉시해지(cancelledAt)와 예약해지(recurringCancelledAt) 를 모두 잡아야 한다 —
    // 한쪽만 보면 예약 해지 건이 날짜 필터에서 통째로 사라진다.
    const cancelledAtField = sql`coalesce(${schema.subscriptionContracts.cancelledAt}, ${schema.subscriptionContracts.recurringCancelledAt})`;

    if (dateFrom) {
      const from = new Date(dateFrom);
      baseConditions.push(
        dateCriteria === 'cancelledAt'
          ? sql`${cancelledAtField} >= ${from}`
          : gte(schema.subscriptionContracts.createdAt, from),
      );
    }

    if (dateTo) {
      const to = endOfDay(new Date(dateTo));
      baseConditions.push(
        dateCriteria === 'cancelledAt'
          ? sql`${cancelledAtField} <= ${to}`
          : lte(schema.subscriptionContracts.createdAt, to),
      );
    }

    // PAUSED/ACTIVE는 entitlement.pausedAt 컬럼으로 SQL에서 직접 구분
    if (status === 'ACTIVE') {
      baseConditions.push(eq(schema.subscriptionContracts.status, 'ACTIVE'));
      baseConditions.push(isNull(schema.subscriptionEntitlement.pausedAt));
    } else if (status === 'PAUSED') {
      baseConditions.push(eq(schema.subscriptionContracts.status, 'ACTIVE'));
      baseConditions.push(isNotNull(schema.subscriptionEntitlement.pausedAt));
    } else if (status === 'CANCELLED') {
      baseConditions.push(eq(schema.subscriptionContracts.status, 'CANCELLED'));
    } else if (status === 'EXPIRED') {
      baseConditions.push(eq(schema.subscriptionContracts.status, 'EXPIRED'));
    } else if (status === 'CANCELLED_ANY') {
      // 해지 내역 화면: 즉시해지 + 해지예약(이용 중) + 해지예약 후 종료. 해지하지 않은 회원은 들어오지 않는다.
      baseConditions.push(
        or(
          eq(schema.subscriptionContracts.status, 'CANCELLED'),
          and(
            inArray(schema.subscriptionContracts.status, ['ACTIVE', 'EXPIRED']),
            isNotNull(schema.subscriptionContracts.recurringCancelledAt),
          ),
        ) as SQL,
      );
    } else if (status === 'RECURRING_CANCELLED_ENDED') {
      // 해지 예약이 이용 종료일을 지나 실제로 끝난 계약. 그냥 만료(1회 결제 종료 등)와 구분된다.
      baseConditions.push(eq(schema.subscriptionContracts.status, 'EXPIRED'));
      baseConditions.push(isNotNull(schema.subscriptionContracts.recurringCancelledAt));
    } else if (status === 'RECURRING_CANCELLED') {
      // 정기결제 해지됐으나 현재 주기는 유효(ACTIVE)한 "해지 예약" 상태.
      // autoRenewal=false 는 one_time 가입자도 가지므로 식별자가 될 수 없다.
      // recurringCancelledAt 은 cancelRecurringPayment 에서만 세팅되므로 이것이 유일한 기준.
      baseConditions.push(eq(schema.subscriptionContracts.status, 'ACTIVE'));
      baseConditions.push(isNotNull(schema.subscriptionContracts.recurringCancelledAt));
    }

    // 환불 요청은 있는데 아직 돈이 안 나간 건 — 관리자가 매일 확인해야 하는 목록이다.
    if (refundPending) {
      baseConditions.push(eq(schema.subscriptionContracts.refundRequested, true));
      baseConditions.push(eq(schema.subscriptionContracts.refundCompleted, false));
    }

    const whereClause = baseConditions.length > 0 ? and(...baseConditions) : undefined;

    const entitlementConditions = and(
      eq(schema.subscriptionEntitlement.userId, schema.subscriptionContracts.userId),
      eq(schema.subscriptionEntitlement.isCurrent, true),
    );

    const latestPerUser = this.dbService.db
      .selectDistinctOn([schema.subscriptionContracts.userId], {
        contractId: schema.subscriptionContracts.id,
        userId: schema.subscriptionContracts.userId,
        contractStatus: schema.subscriptionContracts.status,
        billingDate: schema.subscriptionContracts.billingDate,
        nextBillingDate: schema.subscriptionContracts.nextBillingDate,
        createdAt: schema.subscriptionContracts.createdAt,
        cancelledAt: schema.subscriptionContracts.cancelledAt,
        autoRenewal: schema.subscriptionContracts.autoRenewal,
        cancellationReasonCode: schema.subscriptionContracts.cancellationReasonCode,
        recurringCancellationReasonCode: schema.subscriptionContracts.recurringCancellationReasonCode,
        recurringCancelledAt: schema.subscriptionContracts.recurringCancelledAt,
        isVoided: schema.subscriptionContracts.isVoided,
        voidReason: schema.subscriptionContracts.reason,
        refundRequested: schema.subscriptionContracts.refundRequested,
        refundCompleted: schema.subscriptionContracts.refundCompleted,
        refundCompletedAt: schema.subscriptionContracts.refundCompletedAt,
        eligibleRefundAmount: schema.subscriptionContracts.eligibleRefundAmount,
        lastPaymentIntentId: schema.subscriptionContracts.lastPaymentIntentId,
        billingPath: schema.subscriptionContracts.billingPath,
        planDurationDays: schema.plan.durationDays,
        tierCode: schema.tiers.code,
        tierPriority: schema.tiers.priorityLevel,
        startsAt: schema.subscriptionEntitlement.startsAt,
        endsAt: schema.subscriptionEntitlement.endsAt,
        pausedAt: schema.subscriptionEntitlement.pausedAt,
      })
      .from(schema.subscriptionContracts)
      .innerJoin(schema.plan, eq(schema.subscriptionContracts.planId, schema.plan.id))
      .innerJoin(schema.tiers, eq(schema.plan.tierId, schema.tiers.id))
      .leftJoin(schema.subscriptionEntitlement, entitlementConditions)
      .where(whereClause)
      .orderBy(schema.subscriptionContracts.userId, desc(schema.subscriptionContracts.createdAt))
      .as('lc');

    const [[{ total }], rows] = await Promise.all([
      this.dbService.db.select({ total: count() }).from(latestPerUser),
      this.dbService.db.select().from(latestPerUser).orderBy(desc(latestPerUser.createdAt)).limit(limit).offset(offset),
    ]);

    const data: AdminMemberListItem[] = rows.map((r) => {
      let computedStatus = r.contractStatus;
      if (r.contractStatus === 'ACTIVE' && r.pausedAt !== null) {
        computedStatus = 'PAUSED';
      }

      return {
        contractId: r.contractId,
        userId: r.userId,
        status: computedStatus,
        tierCode: r.tierCode,
        tierPriority: r.tierPriority,
        planDurationDays: r.planDurationDays,
        billingDate: r.billingDate,
        nextBillingDate: r.nextBillingDate,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        isPaused: r.pausedAt !== null,
        pausedAt: r.pausedAt ? r.pausedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
        autoRenewal: r.autoRenewal,
        cancellationReasonCode: r.cancellationReasonCode,
        recurringCancellationReasonCode: r.recurringCancellationReasonCode,
        cancellationReasonText: null as string | null,
        recurringCancelledAt: r.recurringCancelledAt ? r.recurringCancelledAt.toISOString() : null,
        refundRequested: r.refundRequested === true,
        refundCompleted: r.refundCompleted === true,
        refundCompletedAt: r.refundCompletedAt ? r.refundCompletedAt.toISOString() : null,
        eligibleRefundAmount: r.eligibleRefundAmount ?? null,
        hasPaymentIntent: !!r.lastPaymentIntentId,
        billingPath: r.billingPath,
        cancellation: null as CancellationInfo | null,
      };
    });

    // 취소 사유 코드 → 표시 텍스트 해석. 고객 자율 취소 사유는 마스터 테이블에만 존재하므로
    // 코드를 그대로 노출하지 않도록 displayText를 한 번에 조회해 매핑한다.
    // 종료 사실 계산에 쓰는 원천 행(계약 상태·무효화 여부 등)
    const rowByContract = new Map(rows.map((r) => [r.contractId, r]));
    let reasonTextByCode = new Map<string, string>();

    // 종료 경로·사유는 계약 이벤트에 흩어져 있다. 행마다 조회하면 N+1 이라 한 번에 모아 온다.
    const contractIds = data.map((d) => d.contractId);
    const eventsByContract = new Map<string, { eventType: string; causedBy: string; metadata: Record<string, unknown> }[]>();
    if (contractIds.length > 0) {
      const eventRows = await this.dbService.db
        .select({
          contractId: schema.subscriptionContractEvents.contractId,
          eventType: schema.subscriptionContractEvents.eventType,
          causedBy: schema.subscriptionContractEvents.causedBy,
          metadata: schema.subscriptionContractEvents.metadata,
          createdAt: schema.subscriptionContractEvents.createdAt,
        })
        .from(schema.subscriptionContractEvents)
        .where(
          and(
            inArray(schema.subscriptionContractEvents.contractId, contractIds),
            inArray(schema.subscriptionContractEvents.eventType, ['CANCELLED', 'RECURRING_CANCELLED', 'TERMINATED']),
          ),
        )
        .orderBy(desc(schema.subscriptionContractEvents.createdAt), desc(schema.subscriptionContractEvents.id));
      for (const row of eventRows) {
        const list = eventsByContract.get(row.contractId) ?? [];
        list.push({
          eventType: row.eventType,
          causedBy: row.causedBy,
          metadata: (row.metadata ?? {}) as Record<string, unknown>,
        });
        eventsByContract.set(row.contractId, list);
      }
    }

    const reasonCodes = Array.from(
      new Set(
        data
          .flatMap((d) => [d.cancellationReasonCode, d.recurringCancellationReasonCode])
          .filter((c): c is string => !!c),
      ),
    );
    if (reasonCodes.length > 0) {
      const reasonRows = await this.dbService.db
        .select({
          code: schema.cancellationReasons.code,
          displayText: schema.cancellationReasons.displayText,
        })
        .from(schema.cancellationReasons)
        .where(inArray(schema.cancellationReasons.code, reasonCodes));
      const textByCode = new Map(reasonRows.map((row) => [row.code, row.displayText]));
      for (const d of data) {
        const code = d.cancellationReasonCode ?? d.recurringCancellationReasonCode;
        d.cancellationReasonText = code ? textByCode.get(code) ?? null : null;
      }
      reasonTextByCode = textByCode;
    }

    // 종료 경로·상태·사유를 서버가 확정해 내려준다 — 화면이 상태 필드로 추론하면 시스템 종료가
    // '고객이 즉시 해지함' 으로 보인다(라이브에서 실제로 그렇게 보였다).
    for (const d of data) {
      const row = rowByContract.get(d.contractId);
      if (!row) continue;
      d.cancellation = resolveCancellationInfo({
        contract: {
          status: row.contractStatus,
          cancelledAt: row.cancelledAt,
          recurringCancelledAt: row.recurringCancelledAt,
          cancellationReasonCode: row.cancellationReasonCode,
          recurringCancellationReasonCode: row.recurringCancellationReasonCode,
          isVoided: row.isVoided,
          reason: row.voidReason,
        },
        events: eventsByContract.get(d.contractId) ?? [],
        endsAt: d.endsAt,
        reasonTextByCode,
      });
    }

    return { data, total, page, limit };
  }

  async findDetailByUserId(userId: string): Promise<AdminMemberDetail | null> {
    const entitlementConditions = and(
      eq(schema.subscriptionEntitlement.userId, schema.subscriptionContracts.userId),
      eq(schema.subscriptionEntitlement.isCurrent, true),
    );

    const rows = await this.dbService.db
      .select({
        contractId: schema.subscriptionContracts.id,
        userId: schema.subscriptionContracts.userId,
        contractStatus: schema.subscriptionContracts.status,
        billingDate: schema.subscriptionContracts.billingDate,
        nextBillingDate: schema.subscriptionContracts.nextBillingDate,
        createdAt: schema.subscriptionContracts.createdAt,
        cancelledAt: schema.subscriptionContracts.cancelledAt,
        autoRenewal: schema.subscriptionContracts.autoRenewal,
        recurringCancelledAt: schema.subscriptionContracts.recurringCancelledAt,
        recurringCancellationReasonCode: schema.subscriptionContracts.recurringCancellationReasonCode,
        refundRequested: schema.subscriptionContracts.refundRequested,
        refundRequestedAt: schema.subscriptionContracts.refundRequestedAt,
        eligibleRefundAmount: schema.subscriptionContracts.eligibleRefundAmount,
        refundCompleted: schema.subscriptionContracts.refundCompleted,
        refundCompletedAt: schema.subscriptionContracts.refundCompletedAt,
        lastPaymentIntentId: schema.subscriptionContracts.lastPaymentIntentId,
        planId: schema.subscriptionContracts.planId,
        planDurationDays: schema.plan.durationDays,
        tierCode: schema.tiers.code,
        tierPriority: schema.tiers.priorityLevel,
        startsAt: schema.subscriptionEntitlement.startsAt,
        endsAt: schema.subscriptionEntitlement.endsAt,
        pausedAt: schema.subscriptionEntitlement.pausedAt,
      })
      .from(schema.subscriptionContracts)
      .innerJoin(schema.plan, eq(schema.subscriptionContracts.planId, schema.plan.id))
      .innerJoin(schema.tiers, eq(schema.plan.tierId, schema.tiers.id))
      .leftJoin(schema.subscriptionEntitlement, entitlementConditions)
      .where(eq(schema.subscriptionContracts.userId, userId))
      .orderBy(desc(schema.subscriptionContracts.createdAt))
      .limit(1);

    if (!rows.length) return null;

    const r = rows[0];

    const pauseCountResult = await this.dbService.db
      .select({ count: count() })
      .from(pauseEvents)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- same as above
      .where(and(eq(pauseEvents.userId, userId), eq(pauseEvents.eventType, 'START')));
    const pauseCount = Number(pauseCountResult[0]?.count ?? 0);

    const firstContractResult = await this.dbService.db
      .select({ createdAt: schema.subscriptionContracts.createdAt })
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.userId, userId))
      .orderBy(asc(schema.subscriptionContracts.createdAt))
      .limit(1);
    const firstContractCreatedAt = firstContractResult[0]?.createdAt?.toISOString() ?? r.createdAt.toISOString();

    let computedStatus = r.contractStatus;
    if (r.contractStatus === 'ACTIVE' && r.pausedAt !== null) {
      computedStatus = 'PAUSED';
    }

    // 해지 예약 상태에서만 의미가 있는 두 값. 화면이 추론하지 않도록 서버가 판정해 내려준다.
    const canUndoCancellation =
      r.contractStatus === 'ACTIVE' &&
      !!r.recurringCancelledAt &&
      (await this.contractReader.canResumeRecurring({
        id: r.contractId,
        autoRenewal: r.autoRenewal,
        recurringCancelledAt: r.recurringCancelledAt,
      }));
    const refundOutstanding = !!r.refundRequested && !r.refundCompleted;
    const manualRefundAccount = refundOutstanding
      ? await this.contractReader.findManualRefundAccount(r.contractId)
      : null;
    const refundSettlement =
      refundOutstanding && r.lastPaymentIntentId
        ? await this.loadRefundSettlement(r.lastPaymentIntentId)
        : null;

    return {
      contractId: r.contractId,
      userId: r.userId,
      status: computedStatus,
      tierCode: r.tierCode,
      tierPriority: r.tierPriority,
      planId: r.planId,
      planDurationDays: r.planDurationDays,
      billingDate: r.billingDate,
      nextBillingDate: r.nextBillingDate,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      isPaused: r.pausedAt !== null,
      pausedAt: r.pausedAt ? r.pausedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
      autoRenewal: r.autoRenewal,
      recurringCancelledAt: r.recurringCancelledAt ? r.recurringCancelledAt.toISOString() : null,
      recurringCancellationReasonCode: r.recurringCancellationReasonCode ?? null,
      refundRequested: r.refundRequested ?? false,
      refundRequestedAt: r.refundRequestedAt ? r.refundRequestedAt.toISOString() : null,
      eligibleRefundAmount: r.eligibleRefundAmount ?? null,
      refundCompleted: r.refundCompleted ?? false,
      refundCompletedAt: r.refundCompletedAt ? r.refundCompletedAt.toISOString() : null,
      canUndoCancellation,
      hasPaymentIntent: !!r.lastPaymentIntentId,
      manualRefundAccount,
      refundSettlement,
      pauseCount,
      firstContractCreatedAt,
    };
  }

  /**
   * 미완료 환불 건의 wallet 정산 상태. 상세 화면 렌더링 경로라 실패는 흡수한다 —
   * wallet 이 느리다고 멤버십 상세가 통째로 막히면 CS 가 아무것도 못 한다.
   */
  private async loadRefundSettlement(
    intentId: string,
  ): Promise<{ alreadyRefundedAmount: number; pendingRefundAmount: number } | null> {
    try {
      const r = await this.paymentClientService.getRefundability(intentId);
      return {
        alreadyRefundedAmount: r.alreadyRefundedAmount ?? 0,
        pendingRefundAmount: r.pendingRefundAmount ?? 0,
      };
    } catch {
      return null;
    }
  }

  async findBillingEventsByUserId(userId: string): Promise<BillingEventItem[]> {
    const rows = await this.dbService.db
      .select(this.billingEventColumns())
      .from(schema.billingEvents)
      .innerJoin(schema.subscriptionContracts, eq(schema.billingEvents.contractId, schema.subscriptionContracts.id))
      .where(eq(schema.subscriptionContracts.userId, userId))
      .orderBy(desc(schema.billingEvents.createdAt))
      .limit(500);
    return rows.map((r) => this.toBillingEventItem(r));
  }

  async findContractEventsByUserId(userId: string): Promise<ContractEventItem[]> {
    const rows = await this.dbService.db
      .select(this.contractEventColumns())
      .from(schema.subscriptionContractEvents)
      .where(eq(schema.subscriptionContractEvents.userId, userId))
      .orderBy(desc(schema.subscriptionContractEvents.createdAt))
      .limit(500);
    return rows.map((r) => this.toContractEventItem(r));
  }

  async findBillingEventsByContractId(contractId: string): Promise<BillingEventItem[]> {
    const rows = await this.dbService.db
      .select(this.billingEventColumns())
      .from(schema.billingEvents)
      .where(eq(schema.billingEvents.contractId, contractId))
      .orderBy(desc(schema.billingEvents.createdAt));
    return rows.map((r) => this.toBillingEventItem(r));
  }

  async findContractEventsByContractId(contractId: string): Promise<ContractEventItem[]> {
    const rows = await this.dbService.db
      .select(this.contractEventColumns())
      .from(schema.subscriptionContractEvents)
      .where(eq(schema.subscriptionContractEvents.contractId, contractId))
      .orderBy(desc(schema.subscriptionContractEvents.createdAt));
    return rows.map((r) => this.toContractEventItem(r));
  }

  private billingEventColumns() {
    return {
      id: schema.billingEvents.id,
      contractId: schema.billingEvents.contractId,
      eventType: schema.billingEvents.eventType,
      attemptNo: schema.billingEvents.attemptNo,
      amount: schema.billingEvents.amount,
      paymentIntentId: schema.billingEvents.paymentIntentId,
      errorCode: schema.billingEvents.errorCode,
      errorMessage: schema.billingEvents.errorMessage,
      createdAt: schema.billingEvents.createdAt,
    };
  }

  private contractEventColumns() {
    return {
      id: schema.subscriptionContractEvents.id,
      contractId: schema.subscriptionContractEvents.contractId,
      eventType: schema.subscriptionContractEvents.eventType,
      userId: schema.subscriptionContractEvents.userId,
      causedBy: schema.subscriptionContractEvents.causedBy,
      causedByUserId: schema.subscriptionContractEvents.causedByUserId,
      createdAt: schema.subscriptionContractEvents.createdAt,
    };
  }

  private toBillingEventItem(r: {
    id: string;
    contractId: string;
    eventType: string;
    attemptNo: number | null;
    amount: number | null;
    paymentIntentId: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: Date;
  }): BillingEventItem {
    return { ...r, createdAt: r.createdAt.toISOString() };
  }

  private toContractEventItem(r: {
    id: number;
    contractId: string;
    eventType: string;
    userId: string;
    causedBy: string;
    causedByUserId: string | null;
    createdAt: Date;
  }): ContractEventItem {
    return { ...r, createdAt: r.createdAt.toISOString() };
  }

  async findContractPaymentRef(contractId: string): Promise<{ lastPaymentIntentId: string | null } | null> {
    const [row] = await this.dbService.db
      .select({ lastPaymentIntentId: schema.subscriptionContracts.lastPaymentIntentId })
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.id, contractId))
      .limit(1);
    return row ?? null;
  }

  async findContractPaymentRefsByUserId(
    userId: string,
  ): Promise<{ contractId: string; lastPaymentIntentId: string | null }[]> {
    return this.dbService.db
      .select({
        contractId: schema.subscriptionContracts.id,
        lastPaymentIntentId: schema.subscriptionContracts.lastPaymentIntentId,
      })
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.userId, userId));
  }

  async findAllBillingHistory(query: AdminBillingHistoryQuery): Promise<AdminBillingHistoryResponse> {
    const { page = 1, limit = 20, dateFrom, dateTo, contractId, userId, eventType } = query;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [];
    if (contractId) conditions.push(eq(schema.billingEvents.contractId, contractId));
    if (userId) conditions.push(eq(schema.subscriptionContracts.userId, userId));
    if (eventType) conditions.push(eq(schema.billingEvents.eventType, eventType));
    if (dateFrom) conditions.push(gte(schema.billingEvents.createdAt, new Date(dateFrom)));
    if (dateTo) conditions.push(lte(schema.billingEvents.createdAt, endOfDay(new Date(dateTo))));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [[{ total }], paged] = await Promise.all([
      this.dbService.db
        .select({ total: count() })
        .from(schema.billingEvents)
        .innerJoin(schema.subscriptionContracts, eq(schema.billingEvents.contractId, schema.subscriptionContracts.id))
        .where(where),
      this.dbService.db
        .select({
          id: schema.billingEvents.id,
          contractId: schema.billingEvents.contractId,
          userId: schema.subscriptionContracts.userId,
          eventType: schema.billingEvents.eventType,
          attemptNo: schema.billingEvents.attemptNo,
          amount: schema.billingEvents.amount,
          paymentIntentId: schema.billingEvents.paymentIntentId,
          errorCode: schema.billingEvents.errorCode,
          errorMessage: schema.billingEvents.errorMessage,
          createdAt: schema.billingEvents.createdAt,
        })
        .from(schema.billingEvents)
        .innerJoin(schema.subscriptionContracts, eq(schema.billingEvents.contractId, schema.subscriptionContracts.id))
        .where(where)
        .orderBy(desc(schema.billingEvents.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    return {
      data: paged.map((r) => ({
        id: r.id,
        contractId: r.contractId,
        userId: r.userId,
        eventType: r.eventType,
        attemptNo: r.attemptNo,
        amount: r.amount,
        paymentIntentId: r.paymentIntentId,
        errorCode: r.errorCode,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }

  async findRecurringContractsByIds(contractIds: string[]): Promise<AdminRecurringContractSummary[]> {
    if (!contractIds.length) return [];

    const entitlementConditions = and(
      eq(schema.subscriptionEntitlement.userId, schema.subscriptionContracts.userId),
      eq(schema.subscriptionEntitlement.isCurrent, true),
    );

    const rows = await this.dbService.db
      .select({
        contractId: schema.subscriptionContracts.id,
        userId: schema.subscriptionContracts.userId,
        contractStatus: schema.subscriptionContracts.status,
        planId: schema.subscriptionContracts.planId,
        autoRenewal: schema.subscriptionContracts.autoRenewal,
        nextBillingDate: schema.subscriptionContracts.nextBillingDate,
        lastPaymentIntentId: schema.subscriptionContracts.lastPaymentIntentId,
        planDurationDays: schema.plan.durationDays,
        tierCode: schema.tiers.code,
        startsAt: schema.subscriptionEntitlement.startsAt,
        endsAt: schema.subscriptionEntitlement.endsAt,
        pausedAt: schema.subscriptionEntitlement.pausedAt,
      })
      .from(schema.subscriptionContracts)
      .innerJoin(schema.plan, eq(schema.subscriptionContracts.planId, schema.plan.id))
      .innerJoin(schema.tiers, eq(schema.plan.tierId, schema.tiers.id))
      .leftJoin(schema.subscriptionEntitlement, entitlementConditions)
      .where(inArray(schema.subscriptionContracts.id, contractIds));

    return rows.map((r) => {
      let computedStatus = r.contractStatus;
      if (r.contractStatus === 'ACTIVE' && r.pausedAt !== null) {
        computedStatus = 'PAUSED';
      }

      return {
        contractId: r.contractId,
        userId: r.userId,
        status: computedStatus,
        planId: r.planId,
        tierCode: r.tierCode,
        planDurationDays: r.planDurationDays,
        autoRenewal: r.autoRenewal,
        nextBillingDate: r.nextBillingDate,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        lastPaymentIntentId: r.lastPaymentIntentId,
      };
    });
  }

  async updateAutoRenewal(contractId: string, autoRenewal: boolean, adminId: string): Promise<void> {
    // 자동갱신 재활성: membership 상태를 커밋하기 전에 wallet billing agreement 를 먼저 복구한다.
    // 고객 정기결제 해지(cancelRecurringPayment)는 wallet agreement 를 REVOKE 하므로, 상태만 되살리면
    // 다음 스케줄 청구가 BILLING_AGREEMENT_NOT_FOUND 로 실패하고, recurringCancelledAt 을 지운 탓에
    // billing-outcome.handler 가 활성 계약으로 보고 즉시 해지한다. agreement 복구 성공 후에만 커밋한다.
    let restoredNextBillingDate: string | undefined;
    if (autoRenewal) {
      const [contract] = await this.dbService.db
        .select({
          userId: schema.subscriptionContracts.userId,
          nextBillingDate: schema.subscriptionContracts.nextBillingDate,
          recurringCancelledAt: schema.subscriptionContracts.recurringCancelledAt,
        })
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.id, contractId))
        .limit(1);

      if (contract) {
        // (0) 1회 결제 계약은 되살릴 자동결제가 없다. 여기서 막지 않으면 아래 createBillingAgreement 가
        // 자동이체 약정을 새로 만들어, 정기결제에 동의한 적 없는 고객이 다음 주기부터 청구된다.
        // 고객 셀프 철회(undoCancellation)와 같은 기준으로 판정한다.
        const resumable = await this.contractReader.canResumeRecurring({
          id: contractId,
          autoRenewal: false,
          recurringCancelledAt: contract.recurringCancelledAt,
        });
        if (!resumable) {
          throw new ConflictError(
            '1회 결제 계약이라 되살릴 자동결제가 없습니다. 정기결제가 필요하면 고객이 직접 재가입해야 합니다.',
          );
        }

        // (1) 해지로 nextBillingDate 가 null 이면 현재 주기 종료일로 복구해 결제 재개를 보장한다.
        if (!contract.nextBillingDate) {
          const [ent] = await this.dbService.db
            .select({ endsAt: schema.subscriptionEntitlement.endsAt })
            .from(schema.subscriptionEntitlement)
            .where(
              and(
                eq(schema.subscriptionEntitlement.userId, contract.userId),
                eq(schema.subscriptionEntitlement.isCurrent, true),
              ),
            )
            .limit(1);
          // 현재 주기가 이미 만료돼 활성 권한이 없으면 재활성만으로는 결제가 재개되지 않는다(좀비 상태).
          // 조용한 no-op 대신 명확히 거부해 관리자가 재가입을 유도하도록 한다.
          if (!ent?.endsAt) {
            throw new ConflictError(
              '이미 만료된 구독은 자동갱신 재활성으로 복구할 수 없습니다. 재가입이 필요합니다.',
            );
          }
          restoredNextBillingDate = ent.endsAt;
        }

        // (2) 청구 전에 유효한 wallet agreement 를 항상 보장한다. recurringCancelledAt(고객 정기해지)만
        // 보고 재생성하면, agreement 를 애초에 가진 적 없는 일시결제 계약이 이 검증을 빠져나가 nextBillingDate 만
        // 복구된 채 커밋되고, 다음 스케줄 청구가 BILLING_AGREEMENT_NOT_FOUND → 즉시 해지로 이어진다(Finding 3).
        // createBillingAgreement 는 upsert(DB-멱등)라 이미 agreement 가 있는 계약(관리자가 끈 재개 등)엔 안전한
        // no-op 이고, 등록 수단이 없는 계약은 여기서 404/400 으로 걸러 커밋 전에 거부한다.
        try {
          // wallet 은 쓰기 API 에 Idempotency-Key 헤더를 강제하므로 생략할 수 없다 → 시도마다 유니크한 키를 써서,
          // 첫 시도가 5xx 로 실패해도 wallet 이 그 FAILED 응답을 24h 동안 replay 해 재시도를 막는 일을 방지한다.
          // (upsert 라 중복 생성 위험 없음, 관리자 중복 요청은 상위 멱등 계층에서 차단됨)
          await this.paymentClientService.createBillingAgreement(
            contract.userId,
            contractId,
            undefined,
            `membership:reactivate-agreement:${contractId}:${randomUUID()}`,
          );
        } catch (err) {
          const status = isAxiosError(err) ? err.response?.status : undefined;
          // wallet create 는 assertSelectableForRecurringBilling 로 "등록 수단 없음"→404, "비활성"→400 만 낸다.
          // 그 두 신호만 재등록 유도로 매핑하고, 그 외(401/403/429/5xx/비-axios)는 오분류하지 않고 원본을 전파한다.
          if (status !== undefined && [400, 404].includes(status)) {
            throw new ConflictError(
              '등록된 정기결제 수단이 없어 자동갱신을 재개할 수 없습니다. 결제수단을 다시 등록해 주세요.',
            );
          }
          throw err;
        }
      }
    }

    await this.dbService.db.transaction(async (tx) => {
      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({ type: 'AUTO_RENEWAL_CHANGED', effectiveDate: new Date().toISOString().split('T')[0] })
        .returning();

      const updates: {
        autoRenewal: boolean;
        updatedAt: Date;
        nextBillingDate?: string;
        recurringCancelledAt?: Date | null;
        recurringCancellationReasonCode?: string | null;
      } = {
        autoRenewal,
        updatedAt: new Date(),
      };
      if (autoRenewal) {
        updates.recurringCancelledAt = null;
        updates.recurringCancellationReasonCode = null;
        if (restoredNextBillingDate) updates.nextBillingDate = restoredNextBillingDate;
      }

      await tx
        .update(schema.subscriptionContracts)
        .set(updates)
        .where(eq(schema.subscriptionContracts.id, contractId));

      await this.contractEventManager.addEvent(
        tx,
        contractId,
        'AUTO_RENEWAL_CHANGED',
        { autoRenewal },
        'ADMIN',
        adminId,
        batch.id,
        adminId,
      );
    });
  }
  async findRecurringContracts(query: AdminRecurringContractsQuery): Promise<AdminRecurringContractsResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [eq(schema.subscriptionContracts.autoRenewal, true)];
    if (query.userId) conditions.push(eq(schema.subscriptionContracts.userId, query.userId));
    if (query.contractId) conditions.push(eq(schema.subscriptionContracts.id, query.contractId));
    if (query.status) conditions.push(eq(schema.subscriptionContracts.status, query.status));
    const dateField =
      query.dateType === 'createdAt'
        ? schema.subscriptionContracts.createdAt
        : query.dateType === 'nextBillingDate'
          ? schema.subscriptionContracts.nextBillingDate
          : schema.subscriptionContracts.updatedAt;
    if (query.dateFrom) {
      conditions.push(
        query.dateType === 'nextBillingDate'
          ? gte(schema.subscriptionContracts.nextBillingDate, query.dateFrom)
          : gte(dateField as typeof schema.subscriptionContracts.updatedAt, new Date(query.dateFrom)),
      );
    }
    if (query.dateTo) {
      conditions.push(
        query.dateType === 'nextBillingDate'
          ? lte(schema.subscriptionContracts.nextBillingDate, query.dateTo)
          : lte(dateField as typeof schema.subscriptionContracts.updatedAt, endOfDay(new Date(query.dateTo))),
      );
    }

    const whereClause = and(...conditions);

    const entitlementConditions = and(
      eq(schema.subscriptionEntitlement.userId, schema.subscriptionContracts.userId),
      eq(schema.subscriptionEntitlement.isCurrent, true),
    );

    const [[{ total }], rows] = await Promise.all([
      this.dbService.db.select({ total: count() }).from(schema.subscriptionContracts).where(whereClause),
      this.dbService.db
        .select({
          contractId: schema.subscriptionContracts.id,
          userId: schema.subscriptionContracts.userId,
          status: schema.subscriptionContracts.status,
          autoRenewal: schema.subscriptionContracts.autoRenewal,
          nextBillingDate: schema.subscriptionContracts.nextBillingDate,
          lastPaymentIntentId: schema.subscriptionContracts.lastPaymentIntentId,
          billingInProgress: schema.subscriptionContracts.billingInProgress,
          billingStartedAt: schema.subscriptionContracts.billingStartedAt,
          createdAt: schema.subscriptionContracts.createdAt,
          updatedAt: schema.subscriptionContracts.updatedAt,
          tierCode: schema.tiers.code,
          planDurationDays: schema.plan.durationDays,
          startsAt: schema.subscriptionEntitlement.startsAt,
          endsAt: schema.subscriptionEntitlement.endsAt,
        })
        .from(schema.subscriptionContracts)
        .innerJoin(schema.plan, eq(schema.subscriptionContracts.planId, schema.plan.id))
        .innerJoin(schema.tiers, eq(schema.plan.tierId, schema.tiers.id))
        .leftJoin(schema.subscriptionEntitlement, entitlementConditions)
        .where(whereClause)
        .orderBy(desc(schema.subscriptionContracts.updatedAt))
        .limit(limit)
        .offset(offset),
    ]);

    return {
      data: rows.map((r) => ({
        contractId: r.contractId,
        userId: r.userId,
        status: r.status,
        tierCode: r.tierCode,
        planDurationDays: r.planDurationDays,
        autoRenewal: r.autoRenewal,
        nextBillingDate: r.nextBillingDate,
        startsAt: r.startsAt ?? null,
        endsAt: r.endsAt ?? null,
        lastPaymentIntentId: r.lastPaymentIntentId,
        billingInProgress: r.billingInProgress,
        billingStartedAt: r.billingStartedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * billingInProgress=true 상태가 thresholdHours 이상 지속 중인 계약 조회.
   * CMS는 결과가 다음 영업일에 오므로 기본 48시간. 이 이상이면 관리자 확인 필요.
   * billingStartedAt이 있으면 그 값을, 없으면 updatedAt을 fallback으로 사용.
   */
  async findStuckBillingContracts(thresholdHours = 48): Promise<StuckBillingContractsResponse> {
    const thresholdAt = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);

    const rows = await this.dbService.db
      .select({
        id: schema.subscriptionContracts.id,
        userId: schema.subscriptionContracts.userId,
        planId: schema.subscriptionContracts.planId,
        nextBillingDate: schema.subscriptionContracts.nextBillingDate,
        billingStartedAt: schema.subscriptionContracts.billingStartedAt,
        updatedAt: schema.subscriptionContracts.updatedAt,
      })
      .from(schema.subscriptionContracts)
      .where(
        and(
          eq(schema.subscriptionContracts.billingInProgress, true),
          notInArray(schema.subscriptionContracts.status, ['CANCELLED', 'EXPIRED']),
          sql`COALESCE(${schema.subscriptionContracts.billingStartedAt}, ${schema.subscriptionContracts.updatedAt}) <= ${thresholdAt}`,
        ),
      )
      .orderBy(asc(schema.subscriptionContracts.billingStartedAt));

    const now = Date.now();

    return {
      data: rows.map((r) => {
        const since = r.billingStartedAt ?? r.updatedAt;
        return {
          contractId: r.id,
          userId: r.userId,
          planId: r.planId,
          nextBillingDate: r.nextBillingDate ?? null,
          billingInProgressSince: since.toISOString(),
          hoursElapsed: Math.floor((now - since.getTime()) / (1000 * 60 * 60)),
        };
      }),
      total: rows.length,
    };
  }

  /** 결제 실패 재시도 대기(dunning) 중인 계약 목록 — 다음 재시도 임박 순. */
  async findDunningList(): Promise<DunningListResponse> {
    const rows = await this.dbService.db
      .select({
        contractId: schema.membershipDunningQueue.contractId,
        userId: schema.subscriptionContracts.userId,
        attempts: schema.membershipDunningQueue.attempts,
        maxAttempts: schema.membershipDunningQueue.maxAttempts,
        nextRetryAt: schema.membershipDunningQueue.nextRetryAt,
        lastErrorCode: schema.membershipDunningQueue.lastErrorCode,
        lastErrorMessage: schema.membershipDunningQueue.lastErrorMessage,
        createdAt: schema.membershipDunningQueue.createdAt,
      })
      .from(schema.membershipDunningQueue)
      .innerJoin(
        schema.subscriptionContracts,
        eq(schema.membershipDunningQueue.contractId, schema.subscriptionContracts.id),
      )
      .orderBy(asc(schema.membershipDunningQueue.nextRetryAt));

    return {
      data: rows.map((r) => ({
        contractId: r.contractId,
        userId: r.userId,
        attempts: r.attempts,
        maxAttempts: r.maxAttempts,
        nextRetryAt: r.nextRetryAt.toISOString(),
        lastErrorCode: r.lastErrorCode,
        lastErrorMessage: r.lastErrorMessage,
        createdAt: r.createdAt.toISOString(),
      })),
      total: rows.length,
    };
  }

  /**
   * 자동이체 약정 정리 큐 — **은행에 약정이 남아 있는 해지 계약**.
   *
   * 해지는 끝났는데 효성 CMS 약정이 고객 계좌에 살아 있는 상태다. 재청구는 DB 플래그로 막혀 있어
   * 당장 돈이 나가진 않지만, 방치하면 해지한 고객의 계좌에 자동이체 등록이 남아 민원이 된다.
   * 특히 `AGREEMENT_REVOKE_ABANDONED` 는 스케줄러가 **재시도를 멈춘** 건이라 사람이 처리하지 않으면
   * 영원히 그대로다 — 그 사실이 로그에만 있으면 아무도 모른다.
   */
  async findAgreementCleanupQueue(): Promise<AgreementCleanupListResponse> {
    const found = await this.contractReader.findLatestAgreementEvents({
      eventTypes: ['AGREEMENT_REVOKE_PENDING', 'AGREEMENT_REVOKE_DEFERRED', 'AGREEMENT_REVOKE_ABANDONED'],
      limit: 500,
    });
    // 해지를 철회한 계약은 정리 대상이 아니다(스케줄러가 다음 실행에서 큐를 닫는다).
    const states = found.filter((s) => !isAgreementCleanupWithdrawn(s));
    if (states.length === 0) return { data: [], total: 0 };

    const contracts = await this.dbService.db
      .select({
        id: schema.subscriptionContracts.id,
        status: schema.subscriptionContracts.status,
        billingPath: schema.subscriptionContracts.billingPath,
        cancelledAt: schema.subscriptionContracts.cancelledAt,
        recurringCancelledAt: schema.subscriptionContracts.recurringCancelledAt,
      })
      .from(schema.subscriptionContracts)
      .where(
        inArray(
          schema.subscriptionContracts.id,
          states.map((s) => s.contractId),
        ),
      );
    const contractById = new Map(contracts.map((c) => [c.id, c]));

    // 포기(ABANDONED) → 재시도 대기(PENDING) → 보류(DEFERRED) 순. 사람이 봐야 하는 것이 위로 온다.
    const severity: Record<string, number> = {
      AGREEMENT_REVOKE_ABANDONED: 0,
      AGREEMENT_REVOKE_PENDING: 1,
      AGREEMENT_REVOKE_DEFERRED: 2,
    };

    const data = states
      .map((s) => {
        const contract = contractById.get(s.contractId);
        return {
          contractId: s.contractId,
          userId: s.userId,
          state: s.eventType,
          since: s.since.toISOString(),
          /** 보류 건이 정리 대상이 되는 날(=이용 종료일). PENDING/ABANDONED 는 null. */
          notBefore: (s.metadata as { notBefore?: string }).notBefore ?? null,
          /** 왜 정리되지 않았는지. 효성 삭제 가드 등 재시도로 풀리지 않는 사유가 여기 담긴다. */
          reason:
            (s.metadata as { reason?: string }).reason ??
            (s.metadata as { skipReason?: string | null }).skipReason ??
            (s.metadata as { error?: string }).error ??
            null,
          contractStatus: contract?.status ?? null,
          billingPath: contract?.billingPath ?? null,
          cancelledAt: contract?.cancelledAt?.toISOString() ?? contract?.recurringCancelledAt?.toISOString() ?? null,
        };
      })
      .sort((a, b) => (severity[a.state] ?? 9) - (severity[b.state] ?? 9) || a.since.localeCompare(b.since));

    return { data, total: data.length };
  }

  /**
   * 관리자 수동 조작: billingInProgress 플래그 해제.
   * wallet 결과 이벤트가 영구적으로 오지 않는 경우 관리자가 직접 해제하여 다음 주기 결제가 가능하게 함.
   * 감사 이벤트(BILLING_PROGRESS_RESET_BY_ADMIN)를 트랜잭션 안에 기록하여 조작 이력을 남긴다.
   * 서버 측에서도 48h 경과 조건을 강제한다 — UI 제한만으로는 API 직접 호출을 막을 수 없다.
   */
  async resetBillingInProgress(
    contractId: string,
    adminId: string,
    reason: string,
  ): Promise<{ contractId: string; reset: boolean }> {
    const THRESHOLD_HOURS = 48;
    const thresholdAt = new Date(Date.now() - THRESHOLD_HOURS * 60 * 60 * 1000);

    const reset = await this.dbService.db.transaction(async (tx) => {
      const [contract] = await tx
        .select({
          userId: schema.subscriptionContracts.userId,
          billingStartedAt: schema.subscriptionContracts.billingStartedAt,
          updatedAt: schema.subscriptionContracts.updatedAt,
        })
        .from(schema.subscriptionContracts)
        .where(
          and(
            eq(schema.subscriptionContracts.id, contractId),
            eq(schema.subscriptionContracts.billingInProgress, true),
          ),
        )
        .limit(1);

      if (!contract) return false;

      const since = contract.billingStartedAt ?? contract.updatedAt;
      const elapsedHours = Math.floor((Date.now() - since.getTime()) / (1000 * 60 * 60));
      if (since > thresholdAt) {
        throw new Error(
          `잘못된 요청: billingInProgress 경과 시간(${elapsedHours}h)이 기준(${THRESHOLD_HOURS}h) 미만입니다. 정상 결제 처리 중일 수 있습니다.`,
        );
      }

      await tx
        .update(schema.subscriptionContracts)
        .set({ billingInProgress: false, billingStartedAt: null, updatedAt: new Date() })
        .where(eq(schema.subscriptionContracts.id, contractId));

      await this.contractEventManager.addEvent(
        tx,
        contractId,
        'BILLING_PROGRESS_RESET_BY_ADMIN',
        { reason },
        'ADMIN',
        contract.userId,
        undefined,
        adminId,
      );

      return true;
    });

    return { contractId, reset };
  }
}
