import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { BadRequestError } from '@app/shared';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { and, eq, notExists, sql } from 'drizzle-orm';
import { addDays } from 'date-fns';
import { ContractEventManager } from './contract-event.manager';
import { EntitlementManager } from '../entitlement/entitlement.manager';
import { MembershipPolicyService } from '../membership-policy.service';
import { MembershipEventPublisher } from '../membership-event.publisher';
import {
  ActiveSubscriptionExistsException,
  PaymentIntentAlreadyUsedException,
} from '../../shared/exceptions/subscription.exceptions';

function isUniqueViolation(err: unknown, constraint?: string): boolean {
  // drizzle 0.44 는 드라이버 에러를 DrizzleQueryError.cause 로 감싼다.
  for (let e: unknown = err; typeof e === 'object' && e !== null; e = 'cause' in e ? e.cause : undefined) {
    if ('code' in e && e.code === '23505') {
      return !constraint || ('constraint_name' in e && e.constraint_name === constraint);
    }
  }
  return false;
}

const CURRENT_ENTITLEMENT_UNIQUE = 'uq_subscription_entitlement_current_user';

// 정기결제는 월간 플랜(최대 31일)만 허용. 연간 플랜은 1회 결제 전용.
const RECURRING_MAX_DURATION_DAYS = 31;

type Plan = typeof schema.plan.$inferSelect;
type Tier = typeof schema.tiers.$inferSelect;
/** 관리자 임시 지급을 정식 가입으로 이어받을 때 */
export type GrantTakeover = {
  grantContractId: string;
  /** 지급분 남은 일수. 첫 청구일을 max(체험, 이 값) 만큼 미룬다 */
  remainingDays: number;
};
type CreateSubscriptionPaymentRefs = {
  initialPaymentIntentId?: string;
  initialPaymentAttemptId?: string;
  initialWalletReferenceId?: string;
  initialPaymentAmount?: number;
};

/**
 * SubscriptionCreator (Implementation Layer)
 *
 * 역할: 신규 구독 생성 (계약 + 권한)
 * - 계약 생성
 * - 권한 생성
 * - 이벤트 배치 생성
 */
@Injectable()
export class SubscriptionCreator {
  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly contractEventManager: ContractEventManager,
    private readonly entitlementManager: EntitlementManager,
    private readonly policyService: MembershipPolicyService,
    private readonly membershipEventPublisher: MembershipEventPublisher,
  ) {}

  /**
   * 새 구독 생성 (계약 + 권한)
   *
   * one_time 경로는 이 트랜잭션 안에서 MembershipStatusChanged(ACTIVE) 를 아웃박스에 기록해
   * 그룹 동기화 이벤트가 구독 커밋과 원자적으로 남게 한다(발행 유실 방지). recurring 은 가입 후
   * billing_agreement 실패 시 void 될 수 있어 여기서 발행하지 않고 호출부가 최종 성공 후 발행한다.
   */
  async createNewSubscription(
    userId: string,
    plan: Plan,
    tier: Tier,
    paymentRefs: CreateSubscriptionPaymentRefs = {},
    billingMode: 'one_time' | 'recurring' = 'one_time',
    skipTrial = false,
    billingPath: 'CHARGE' | 'INVOICE' = 'CHARGE',
    email = '',
    grantTakeover?: GrantTakeover,
  ): Promise<{ contractId: string; entitlementId: string; effectiveTrialDays: number }> {
    if (billingMode === 'recurring' && plan.durationDays > RECURRING_MAX_DURATION_DAYS) {
      throw new BadRequestError(
        `정기결제는 월간 플랜(최대 ${RECURRING_MAX_DURATION_DAYS}일)만 지원합니다. (durationDays=${plan.durationDays})`,
      );
    }

    try {
      return await this.createInTx(
        userId,
        plan,
        tier,
        paymentRefs,
        billingMode,
        skipTrial,
        billingPath,
        email,
        grantTakeover,
      );
    } catch (err: unknown) {
      // 동시에 들어온 다른 가입이 먼저 이용권을 만들었다 — 이 가입은 통째로 롤백됐다.
      if (isUniqueViolation(err, CURRENT_ENTITLEMENT_UNIQUE)) throw new ActiveSubscriptionExistsException();
      throw err;
    }
  }

  private async createInTx(
    userId: string,
    plan: Plan,
    tier: Tier,
    paymentRefs: CreateSubscriptionPaymentRefs,
    billingMode: 'one_time' | 'recurring',
    skipTrial: boolean,
    billingPath: 'CHARGE' | 'INVOICE',
    email: string,
    grantTakeover?: GrantTakeover,
  ): Promise<{ contractId: string; entitlementId: string; effectiveTrialDays: number }> {
    return await this.dbService.db.transaction(async (tx) => {
      const now = new Date();
      const startsAt = now;

      // 같은 사용자의 가입을 한 줄로 세운다. 행 잠금만으로는 이용권이 아직 없을 때 잠글 것이 없어,
      // 동시에 들어온 두 가입이 서로의 이용권을 닫고 각자 계약을 만든다.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`membership-signup:${userId}`}))`);

      // 호출부 가드와 이 트랜잭션 사이에 다른 가입이 커밋됐을 수 있다. 그 이용권을 닫고 덮어쓰지 않게 다시 본다.
      const findCurrent = async () => {
        const [row] = await tx
          .select({ id: schema.subscriptionEntitlement.id })
          .from(schema.subscriptionEntitlement)
          .where(
            and(eq(schema.subscriptionEntitlement.userId, userId), eq(schema.subscriptionEntitlement.isCurrent, true)),
          )
          .limit(1);
        return row;
      };
      const current = await findCurrent();
      let grantExpired = false;
      if (current && !grantTakeover) throw new ActiveSubscriptionExistsException();
      if (grantTakeover) {
        // 다른 가입이 먼저 이 지급분을 이어받았으면 그 가입을 덮어쓰지 않는다.
        const [grant] = await tx
          .select({ status: schema.subscriptionContracts.status })
          .from(schema.subscriptionContracts)
          .where(eq(schema.subscriptionContracts.id, grantTakeover.grantContractId))
          .limit(1);
        // 만료 크론이 읽기와 이 트랜잭션 사이에 지급 계약을 닫았을 수 있다 — 중복이 아니라 남은 일수 0 인 일반 가입이다.
        // 만료 처리는 지급 이용권의 isCurrent 도 같은 트랜잭션에서 내리므로, 남아 있는 current 는 다른 가입의 것이다.
        if (grant?.status === 'EXPIRED') {
          // 위 current 는 만료 커밋 직전에 읽었을 수 있다 — EXPIRED 를 본 뒤 다시 읽어 판정한다.
          if (await findCurrent()) throw new ActiveSubscriptionExistsException();
          grantExpired = true;
        } else if (grant?.status !== 'ACTIVE') throw new ActiveSubscriptionExistsException();
      }

      // 같은 결제로 기존 계약이 이미 생성됐으면 재사용(replay) 거부.
      // billing_events 의 uq_billing_events_intent_event 가 동시 요청 레이스를 막고,
      // 이 선조회는 intentId 가 이벤트에 기록되지 않은 레거시 계약까지 커버한다.
      if (paymentRefs.initialPaymentIntentId) {
        const [existing] = await tx
          .select({ id: schema.subscriptionContracts.id })
          .from(schema.subscriptionContracts)
          .where(eq(schema.subscriptionContracts.lastPaymentIntentId, paymentRefs.initialPaymentIntentId))
          .limit(1);
        if (existing) {
          throw new PaymentIntentAlreadyUsedException();
        }
      }

      // 무료체험은 정기결제 첫 구독자에게만 적용 (관리자 생성 시 skipTrial=true)
      let effectiveTrialDays = 0;
      if (billingMode === 'recurring' && !skipTrial) {
        const [isFirstTime, trialReuseEnabled] = await Promise.all([
          this.isFirstTimeSubscriber(userId),
          this.policyService.getBooleanPolicy('TRIAL_REUSE_PREVENTION', 'enabled', plan.tierId, true),
        ]);
        effectiveTrialDays = (isFirstTime || !trialReuseEnabled) ? (plan.trialDays || 0) : 0;
      }

      const autoRenewal = billingMode === 'recurring';
      const billingDate = addDays(startsAt, Math.max(effectiveTrialDays, (grantExpired ? 0 : grantTakeover?.remainingDays) ?? 0));
      // nextBillingDate = billingDate: 체험 종료일이 곧 첫 결제일
      // 결제 성공 시 BillingOutcomeHandler가 nextBillingDate를 endsAt + durationDays로 갱신
      const nextBillingDate = billingMode === 'recurring' ? billingDate : null;
      // recurring: endsAt = 체험 종료일 (첫 결제 시 +durationDays 연장)
      // one_time: endsAt = 결제된 전체 서비스 기간 (이어받기면 남은 임시 일수 뒤에 붙는다)
      const endsAt = billingMode === 'recurring'
        ? billingDate
        : addDays(billingDate, plan.durationDays);

      // 1. 이벤트 배치 생성
      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: 'SUBSCRIPTION_CREATED',
          effectiveDate: now.toISOString().split('T')[0],
        })
        .returning();

      // 2. 구독 계약 생성
      const [contract] = await tx
        .insert(schema.subscriptionContracts)
        .values({
          userId,
          planId: plan.id,
          autoRenewal,
          billingPath: billingMode === 'recurring' ? billingPath : 'CHARGE',
          billingDate: billingDate.toISOString().split('T')[0],
          nextBillingDate: nextBillingDate ? nextBillingDate.toISOString().split('T')[0] : null,
          lastPaymentIntentId: paymentRefs.initialPaymentIntentId ?? null,
          lastPaymentAttemptId: paymentRefs.initialPaymentAttemptId ?? null,
          walletReferenceId: paymentRefs.initialWalletReferenceId ?? null,
        })
        .returning();

      // 3. 계약 이벤트 기록
      await this.contractEventManager.addEvent(
        tx,
        contract.id,
        'CREATED',
        {
          planId: plan.id,
          billingDate: billingDate.toISOString().split('T')[0],
          billingMode,
          effectiveTrialDays,
        },
        'USER',
        userId,
        batch.id,
        userId,
      );

      // 4. 최초 결제 기록. paymentIntentId 를 함께 남겨 uq_billing_events_intent_event 가
      //    같은 결제로 새 계약을 재발급하는 replay 를 DB 레벨에서 차단하게 한다.
      if (paymentRefs.initialPaymentIntentId && paymentRefs.initialPaymentAmount != null) {
        try {
          await tx.insert(schema.billingEvents).values({
            contractId: contract.id,
            eventType: 'CHARGE_SUCCESS',
            attemptNo: 1,
            amount: paymentRefs.initialPaymentAmount,
            paymentIntentId: paymentRefs.initialPaymentIntentId,
          });
        } catch (err: unknown) {
          if (isUniqueViolation(err)) {
            throw new PaymentIntentAlreadyUsedException();
          }
          throw err;
        }
      }

      // 지급 계약을 닫는다. 지급 이용권은 아래 createEntitlement 가 종료한다.
      if (grantTakeover && !grantExpired) {
        await tx
          .update(schema.subscriptionContracts)
          .set({
            status: 'CANCELLED',
            cancelledAt: now,
            cancellationReasonCode: 'SUPERSEDED_BY_SUBSCRIPTION',
            autoRenewal: false,
            nextBillingDate: null,
          })
          .where(eq(schema.subscriptionContracts.id, grantTakeover.grantContractId));
        await this.contractEventManager.addEvent(
          tx,
          grantTakeover.grantContractId,
          'SUPERSEDED_BY_SUBSCRIPTION',
          { newContractId: contract.id, remainingDays: grantTakeover.remainingDays },
          'USER',
          userId,
          batch.id,
          userId,
        );
      }

      // 5. 구독 권한 생성
      const entitlement = await this.entitlementManager.createEntitlement(
        tx,
        userId,
        tier.id,
        startsAt,
        endsAt,
        batch.id,
      );

      // one_time 은 이 시점에 구독이 최종 확정(이후 void 되는 후속 단계 없음)이므로
      // 그룹 동기화 이벤트를 같은 트랜잭션의 아웃박스에 원자적으로 기록한다.
      if (billingMode === 'one_time') {
        await this.membershipEventPublisher.saveStatusChanged(
          {
            userId,
            email,
            status: 'ACTIVE',
            occurredAt: now.toISOString(),
            contractId: contract.id,
            planId: plan.id,
            tierId: tier.id,
            reasonCode: 'SUBSCRIBED',
          },
          tx,
        );
      }

      return {
        contractId: contract.id,
        entitlementId: entitlement.id,
        effectiveTrialDays,
      };
    });
  }

  /**
   * 첫 구독 여부 확인 (무료 체험 악용 방지)
   *
   * 과거 구독 이력이 없으면 첫 구독으로 판단. 관리자 임시 지급은 고객이 가입한 이력이 아니라서 세지 않는다.
   */
  private async isFirstTimeSubscriber(userId: string): Promise<boolean> {
    const contracts = await this.dbService.db
      .select({ id: schema.subscriptionContracts.id })
      .from(schema.subscriptionContracts)
      .where(
        and(
          eq(schema.subscriptionContracts.userId, userId),
          notExists(
            this.dbService.db
              .select({ id: schema.subscriptionContractEvents.id })
              .from(schema.subscriptionContractEvents)
              .where(
                and(
                  eq(schema.subscriptionContractEvents.contractId, schema.subscriptionContracts.id),
                  eq(schema.subscriptionContractEvents.eventType, 'GRANTED_BY_ADMIN'),
                ),
              ),
          ),
        ),
      )
      .limit(1);

    return contracts.length === 0;
  }
}
