import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { eq, and, desc, inArray, count } from 'drizzle-orm';

type Contract = typeof schema.subscriptionContracts.$inferSelect;
type Plan = typeof schema.plan.$inferSelect;

/**
 * 자동이체 약정 정리의 상태 축.
 * PENDING(재시도 대기) · DEFERRED(수금 끝날 때까지 보류) · REVOKED(끝남) · ABANDONED(7일 초과, 사람이 처리) ·
 * UNDONE(해지 철회로 정리 지시 자체가 사라짐).
 */
export const AGREEMENT_EVENT_TYPES = [
  'AGREEMENT_REVOKE_PENDING',
  'AGREEMENT_REVOKE_DEFERRED',
  'AGREEMENT_REVOKED',
  'AGREEMENT_REVOKE_ABANDONED',
  'AGREEMENT_REVOKE_UNDONE',
] as const;

export type AgreementEventType = (typeof AGREEMENT_EVENT_TYPES)[number];

export interface AgreementEventState {
  contractId: string;
  userId: string;
  eventType: AgreementEventType;
  metadata: Record<string, unknown>;
  since: Date;
  /** 계약의 현재 상태. 아직 해지 중인 계약인지 봐야 정리 대상을 가릴 수 있다. */
  contract: { status: string; autoRenewal: boolean; recurringCancelledAt: Date | null } | null;
}

/**
 * 정리 지시가 철회된 계약인지.
 *
 * 해지 철회는 wallet 약정을 새로 만들지만 해지 때 남긴 `_PENDING`/`_DEFERRED` 는 그대로 남는다.
 * 두면 정리 스케줄러가 살아있는 약정을 지우고, 다음 청구가 BILLING_AGREEMENT_NOT_FOUND 로 실패해
 * 그대로 해지된다.
 */
export function isCleanupWithdrawnBy(
  contract: { status: string; autoRenewal: boolean | null; recurringCancelledAt: Date | null } | null,
): boolean {
  if (!contract) return false;
  return contract.status === 'ACTIVE' && contract.autoRenewal === true && contract.recurringCancelledAt === null;
}

export function isAgreementCleanupWithdrawn(state: AgreementEventState): boolean {
  return isCleanupWithdrawnBy(state.contract);
}

@Injectable()
export class SubscriptionContractReader {
  constructor(private readonly dbService: DbService<typeof membershipSchema>) {}

  /**
   * 활성 계약 조회
   */
  async findActiveContract(userId: string): Promise<Contract | null> {
    // ACTIVE 계약이 복수인 창(재가입)에서 임의 선택 방지 — 최신 1건
    const [contract] = await this.dbService.db
      .select()
      .from(schema.subscriptionContracts)
      .where(and(eq(schema.subscriptionContracts.userId, userId), eq(schema.subscriptionContracts.status, 'ACTIVE')))
      .orderBy(desc(schema.subscriptionContracts.createdAt), desc(schema.subscriptionContracts.id))
      .limit(1);

    return contract || null;
  }

  /**
   * 결제 Intent ID로 계약 조회 (환불 회수 경로용 — status 무관, 최신 1건)
   */
  async findByPaymentIntentId(intentId: string): Promise<Contract | null> {
    const [contract] = await this.dbService.db
      .select()
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.lastPaymentIntentId, intentId))
      .orderBy(desc(schema.subscriptionContracts.createdAt))
      .limit(1);

    return contract || null;
  }

  /**
   * 계약 ID로 조회
   */
  async findById(contractId: string): Promise<Contract | null> {
    const [contract] = await this.dbService.db
      .select()
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.id, contractId))
      .limit(1);

    return contract || null;
  }

  /**
   * 플랜 조회
   */
  async findPlan(planId: string): Promise<Plan | null> {
    const [plan] = await this.dbService.db.select().from(schema.plan).where(eq(schema.plan.id, planId)).limit(1);

    return plan || null;
  }

  /**
   * 계약과 플랜 함께 조회
   */
  async findContractWithPlan(userId: string): Promise<{ contract: Contract; plan: Plan } | null> {
    const contract = await this.findActiveContract(userId);
    if (!contract) return null;

    const plan = await this.findPlan(contract.planId);
    if (!plan) return null;

    return { contract, plan };
  }

  /**
   * 현재 활성 권한 조회 (해지 시 이용 종료일 판단용)
   */
  async findCurrentEntitlement(
    userId: string,
  ): Promise<{ id: string; endsAt: string; startsAt: string; pausedAt: Date | null } | null> {
    const [entitlement] = await this.dbService.db
      .select({
        id: schema.subscriptionEntitlement.id,
        endsAt: schema.subscriptionEntitlement.endsAt,
        startsAt: schema.subscriptionEntitlement.startsAt,
        // 정지 중에는 endsAt 이 동결돼 있다(재개 시점에 정지 일수만큼 연장). 해지 화면이 이 값을
        // 그대로 '이용 종료일'로 보여주면 이미 쌓인 정지 일수를 통째로 떼먹는 안내가 된다.
        pausedAt: schema.subscriptionEntitlement.pausedAt,
      })
      .from(schema.subscriptionEntitlement)
      .where(
        and(eq(schema.subscriptionEntitlement.userId, userId), eq(schema.subscriptionEntitlement.isCurrent, true)),
      )
      .limit(1);

    return entitlement || null;
  }

  /**
   * 동일 티어의 활성 월간 플랜 정가.
   *
   * 연간 중도해지 정산의 기준값이다. 연간가는 '월간 정가 × 12 − 2개월' 로 만들어졌으므로,
   * 월간 플랜이 없거나 비활성이면 연간가/10 을 같은 뜻의 폴백으로 쓴다.
   */
  async findMonthlyListPrice(tierId: string, annualPrice: number): Promise<number> {
    const [monthly] = await this.dbService.db
      .select({ price: schema.plan.price })
      .from(schema.plan)
      .where(and(eq(schema.plan.tierId, tierId), eq(schema.plan.durationDays, 30), eq(schema.plan.isActive, true)))
      .orderBy(desc(schema.plan.createdAt))
      .limit(1);

    return monthly?.price ?? Math.round(annualPrice / 10);
  }

  /**
   * 이번 결제 주기가 실제로 시작된 시각 = 마지막 결제 성공 시각.
   *
   * `entitlement.endsAt − durationDays` 로 역산하면 결제와 무관하게 endsAt 를 미는 경로
   * (관리자 기간 조정 `ENTITLEMENT_EXTENDED`, 일시정지 재개)에서 주기 시작이 함께 밀려,
   * **청약철회 7일 창이 되살아난다.** 결제 사실은 billing_events(CHARGE_SUCCESS)가 원천이다.
   */
  async findLastChargeSuccessAt(contractId: string): Promise<Date | null> {
    const [row] = await this.dbService.db
      .select({ createdAt: schema.billingEvents.createdAt })
      .from(schema.billingEvents)
      .where(
        and(
          eq(schema.billingEvents.contractId, contractId),
          eq(schema.billingEvents.eventType, 'CHARGE_SUCCESS'),
        ),
      )
      .orderBy(desc(schema.billingEvents.createdAt))
      .limit(1);

    return row?.createdAt ?? null;
  }

  /**
   * 해지 예약된 계약이 **원래 정기결제였는지**.
   *
   * `autoRenewal` 은 해지 시 false 로 꺼지므로, 해지 후에는 1회 결제와 구분되지 않는다.
   * 그렇다고 `recurringCancelledAt` 이 있으면 정기결제로 보면 1회 결제 고객에게 '해지 철회(자동결제
   * 재개)' 를 열어주게 되고, 철회는 wallet 자동이체 약정을 새로 만들어 **동의한 적 없는 정기결제로
   * 전환**시킨다. 그래서 해지 시점의 사실(RECURRING_CANCELLED 이벤트)에서 읽는다.
   *
   * - `wasRecurring`: 이 브랜치 이후의 해지가 남기는 명시 플래그
   * - `nextBillingDateBefore`: 그 이전 기록의 폴백 — 1회 결제는 nextBillingDate 가 항상 null 이다
   */
  async wasRecurringBeforeCancellation(contractId: string): Promise<boolean> {
    const [event] = await this.dbService.db
      .select({ metadata: schema.subscriptionContractEvents.metadata })
      .from(schema.subscriptionContractEvents)
      .where(
        and(
          eq(schema.subscriptionContractEvents.contractId, contractId),
          eq(schema.subscriptionContractEvents.eventType, 'RECURRING_CANCELLED'),
        ),
      )
      .orderBy(desc(schema.subscriptionContractEvents.createdAt), desc(schema.subscriptionContractEvents.id))
      .limit(1);

    if (!event) return false;
    const metadata = (event.metadata ?? {}) as { wasRecurring?: boolean; nextBillingDateBefore?: string | null };
    if (typeof metadata.wasRecurring === 'boolean') return metadata.wasRecurring;
    return metadata.nextBillingDateBefore != null;
  }

  /**
   * 이 계약의 자동결제를 **되살려도 되는지**.
   *
   * 해지 철회(고객)·자동갱신 재활성(관리자)은 wallet 자동이체 약정을 새로 만든다. 1회 결제 고객에게
   * 열어주면 **동의한 적 없는 정기결제가 시작된다.** 해지 후에는 `autoRenewal` 이 꺼져 1회 결제와
   * 구분되지 않으므로, 가입 시점(CREATED.billingMode)과 해지 시점(RECURRING_CANCELLED.wasRecurring)의
   * 사실에서 판정한다.
   *
   * 셋 다 없으면 **되살리지 않는다.** 근거가 없는 계약의 대부분은 관리자 지급·cafe24 이관분이고
   * (라이브 활성 계약 697건 중 398건이 결제 이력 자체가 없다), 이들에게 자동결제를 켜면 동의한 적
   * 없는 계좌 출금이 시작된다. 옛 정기결제 계약은 (a) autoRenewal 이 살아있거나 (b) 해지 기록이
   * 있거나 (c) 예전 '자동 연장' 토글로 끈 기록(AUTO_RENEWAL_CHANGED)이 남아 있어 위 세 근거 중
   * 하나에 걸린다. 근거 없이 막힌 고객은 재가입이라는 창구가 있지만, 근거 없이 시작된 출금은
   * 되돌릴 창구가 없다.
   */
  async canResumeRecurring(contract: Pick<Contract, 'id' | 'autoRenewal' | 'recurringCancelledAt'>): Promise<boolean> {
    if (contract.autoRenewal) return true;

    const billingMode = await this.findCreatedBillingMode(contract.id);
    if (billingMode) return billingMode === 'recurring';
    if (contract.recurringCancelledAt) return this.wasRecurringBeforeCancellation(contract.id);
    return this.wasAutoRenewalDisabledByAdmin(contract.id);
  }

  /**
   * 예전 관리자 '자동 연장' 토글로 정기결제를 끈 흔적. CREATED 메타데이터가 없던 시절의 계약이
   * 정기결제였음을 보여주는 유일한 기록이라, 해지 철회/재활성을 열어줄 근거로 쓴다.
   */
  private async wasAutoRenewalDisabledByAdmin(contractId: string): Promise<boolean> {
    const [event] = await this.dbService.db
      .select({ metadata: schema.subscriptionContractEvents.metadata })
      .from(schema.subscriptionContractEvents)
      .where(
        and(
          eq(schema.subscriptionContractEvents.contractId, contractId),
          eq(schema.subscriptionContractEvents.eventType, 'AUTO_RENEWAL_CHANGED'),
        ),
      )
      .orderBy(desc(schema.subscriptionContractEvents.createdAt), desc(schema.subscriptionContractEvents.id))
      .limit(1);

    if (!event) return false;
    return ((event.metadata ?? {}) as { autoRenewal?: boolean }).autoRenewal === false;
  }

  /** 가입 시점의 결제 방식(CREATED 이벤트에 기록). 옛 계약은 없을 수 있어 null 을 돌려준다. */
  private async findCreatedBillingMode(contractId: string): Promise<'recurring' | 'one_time' | null> {
    const [event] = await this.dbService.db
      .select({ metadata: schema.subscriptionContractEvents.metadata })
      .from(schema.subscriptionContractEvents)
      .where(
        and(
          eq(schema.subscriptionContractEvents.contractId, contractId),
          eq(schema.subscriptionContractEvents.eventType, 'CREATED'),
        ),
      )
      .orderBy(desc(schema.subscriptionContractEvents.createdAt), desc(schema.subscriptionContractEvents.id))
      .limit(1);

    const mode = ((event?.metadata ?? {}) as { billingMode?: string }).billingMode;
    return mode === 'recurring' || mode === 'one_time' ? mode : null;
  }

  /**
   * 계좌 송금이 남아 있는 환불 건의 수취 계좌.
   *
   * 자동환불이 불가능한 수단(효성 CMS)이나 자동환불 실패 건은 관리자가 직접 송금해야 끝난다.
   * 그 계좌는 해지 시점에 REFUND_PENDING/REFUND_FAILED 이벤트에 남겨두므로 여기서 다시 읽는다.
   */
  async findManualRefundAccount(
    contractId: string,
  ): Promise<{ bank: string; accountNumber: string; holderName: string } | null> {
    const [event] = await this.dbService.db
      .select({ metadata: schema.subscriptionContractEvents.metadata })
      .from(schema.subscriptionContractEvents)
      .where(
        and(
          eq(schema.subscriptionContractEvents.contractId, contractId),
          inArray(schema.subscriptionContractEvents.eventType, ['REFUND_PENDING', 'REFUND_FAILED']),
        ),
      )
      .orderBy(desc(schema.subscriptionContractEvents.createdAt), desc(schema.subscriptionContractEvents.id))
      .limit(1);

    const account = ((event?.metadata ?? {}) as { receiveAccount?: Record<string, unknown> }).receiveAccount;
    if (!account || typeof account.accountNumber !== 'string') return null;
    return {
      bank: String(account.bank ?? ''),
      accountNumber: account.accountNumber,
      holderName: String(account.holderName ?? ''),
    };
  }

  /**
   * 계약별 **최신** 자동이체 약정 정리 이벤트.
   *
   * 약정 정리에는 상태 컬럼이 없다(스키마를 늘리지 않으려고). 대신 계약별 마지막 약정 이벤트가
   * 곧 현재 상태다 — REVOKED/ABANDONED 가 붙으면 자동으로 큐에서 빠진다. 재시도 스케줄러와
   * 관리자 화면이 **같은 정의**를 봐야 "화면엔 없는데 매시간 재시도되는" 상태가 안 생기므로
   * 그 판정을 여기 한 곳에 둔다.
   */
  async findLatestAgreementEvents(params: {
    eventTypes: AgreementEventType[];
    limit: number;
  }): Promise<AgreementEventState[]> {
    const latest = this.dbService.db
      .selectDistinctOn([schema.subscriptionContractEvents.contractId], {
        contractId: schema.subscriptionContractEvents.contractId,
        userId: schema.subscriptionContractEvents.userId,
        eventType: schema.subscriptionContractEvents.eventType,
        metadata: schema.subscriptionContractEvents.metadata,
        createdAt: schema.subscriptionContractEvents.createdAt,
      })
      .from(schema.subscriptionContractEvents)
      .where(inArray(schema.subscriptionContractEvents.eventType, AGREEMENT_EVENT_TYPES))
      .orderBy(
        schema.subscriptionContractEvents.contractId,
        desc(schema.subscriptionContractEvents.createdAt),
        desc(schema.subscriptionContractEvents.id),
      )
      .as('latest');

    const rows = await this.dbService.db
      .select({
        contractId: latest.contractId,
        userId: latest.userId,
        eventType: latest.eventType,
        metadata: latest.metadata,
        since: latest.createdAt,
        status: schema.subscriptionContracts.status,
        autoRenewal: schema.subscriptionContracts.autoRenewal,
        recurringCancelledAt: schema.subscriptionContracts.recurringCancelledAt,
      })
      .from(latest)
      .leftJoin(schema.subscriptionContracts, eq(schema.subscriptionContracts.id, latest.contractId))
      .where(inArray(latest.eventType, params.eventTypes))
      .orderBy(latest.createdAt)
      .limit(params.limit);

    return rows.map((r) => ({
      contractId: r.contractId,
      userId: r.userId,
      eventType: r.eventType as AgreementEventType,
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
      since: r.since,
      contract:
        r.status === null
          ? null
          : { status: r.status, autoRenewal: r.autoRenewal === true, recurringCancelledAt: r.recurringCancelledAt },
    }));
  }

  /**
   * 환불을 요청한 가장 최근 계약. 해지된 뒤에도 고객이 진행 상황을 봐야 하므로 상태로 거르지 않는다.
   */
  async findLatestRefundRequestedContract(userId: string): Promise<Contract | null> {
    const [contract] = await this.dbService.db
      .select()
      .from(schema.subscriptionContracts)
      .where(
        and(
          eq(schema.subscriptionContracts.userId, userId),
          eq(schema.subscriptionContracts.refundRequested, true),
        ),
      )
      .orderBy(desc(schema.subscriptionContracts.refundRequestedAt), desc(schema.subscriptionContracts.createdAt))
      .limit(1);

    return contract || null;
  }

  /** 이 계약의 최신 환불 결과 이벤트. 완료 전 상태(대기/실패)를 구분하는 데 쓴다. */
  async findLatestRefundOutcome(contractId: string): Promise<string | null> {
    const [event] = await this.dbService.db
      .select({ eventType: schema.subscriptionContractEvents.eventType })
      .from(schema.subscriptionContractEvents)
      .where(
        and(
          eq(schema.subscriptionContractEvents.contractId, contractId),
          inArray(schema.subscriptionContractEvents.eventType, [
            'REFUND_COMPLETED',
            'REFUND_PENDING',
            'REFUND_FAILED',
          ]),
        ),
      )
      .orderBy(desc(schema.subscriptionContractEvents.createdAt), desc(schema.subscriptionContractEvents.id))
      .limit(1);

    return event?.eventType ?? null;
  }

  /** 이 계약의 최신 약정 정리 이벤트 종류. 정리 지시가 아직 열려 있는지 판단하는 용도. */
  async findLatestAgreementEventType(contractId: string): Promise<AgreementEventType | null> {
    const [event] = await this.dbService.db
      .select({ eventType: schema.subscriptionContractEvents.eventType })
      .from(schema.subscriptionContractEvents)
      .where(
        and(
          eq(schema.subscriptionContractEvents.contractId, contractId),
          inArray(schema.subscriptionContractEvents.eventType, AGREEMENT_EVENT_TYPES),
        ),
      )
      .orderBy(desc(schema.subscriptionContractEvents.createdAt), desc(schema.subscriptionContractEvents.id))
      .limit(1);

    return (event?.eventType as AgreementEventType) ?? null;
  }

  /**
   * 사용자의 모든 계약 이력 조회
   */
  async findContractsByUserId(userId: string): Promise<Contract[]> {
    return await this.dbService.db
      .select()
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.userId, userId))
      .orderBy(desc(schema.subscriptionContracts.createdAt));
  }

  /**
   * 사용자의 모든 계약 이력 + 플랜/티어 정보 함께 조회
   */
  async findContractsByUserIdWithPlan(userId: string) {
    return await this.dbService.db
      .select({
        contract: schema.subscriptionContracts,
        plan: schema.plan,
        tier: schema.tiers,
      })
      .from(schema.subscriptionContracts)
      .innerJoin(schema.plan, eq(schema.subscriptionContracts.planId, schema.plan.id))
      .leftJoin(schema.tiers, eq(schema.plan.tierId, schema.tiers.id))
      .where(eq(schema.subscriptionContracts.userId, userId))
      .orderBy(desc(schema.subscriptionContracts.createdAt));
  }

  /**
   * 멤버십 기록조회
   */
  async findContractsByUserIdWithPlanPaged(userId: string, limit: number, offset: number) {
    return await this.dbService.db
      .select({
        contract: schema.subscriptionContracts,
        plan: schema.plan,
        tier: schema.tiers,
      })
      .from(schema.subscriptionContracts)
      .innerJoin(schema.plan, eq(schema.subscriptionContracts.planId, schema.plan.id))
      .leftJoin(schema.tiers, eq(schema.plan.tierId, schema.tiers.id))
      .where(eq(schema.subscriptionContracts.userId, userId))
      .orderBy(desc(schema.subscriptionContracts.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /**
   * 사용자의 전체 계약 이력 건수 조회
   */
  async countContractsByUserId(userId: string): Promise<number> {
    const [row] = await this.dbService.db
      .select({ value: count() })
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.userId, userId));

    return row?.value ?? 0;
  }

  /**
   * 사용자의 구독 기간 조정 이벤트 조회 (ENTITLEMENT_EXTENDED / ENTITLEMENT_REDUCED)
   */
  async findAdjustmentEventsByUserId(userId: string) {
    return await this.dbService.db
      .select()
      .from(schema.subscriptionContractEvents)
      .where(
        and(
          eq(schema.subscriptionContractEvents.userId, userId),
          inArray(schema.subscriptionContractEvents.eventType, [
            'ENTITLEMENT_EXTENDED',
            'ENTITLEMENT_REDUCED',
            'GRANTED_BY_ADMIN',
          ]),
        ),
      )
      .orderBy(desc(schema.subscriptionContractEvents.createdAt));
  }
}
