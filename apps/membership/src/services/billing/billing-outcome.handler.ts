import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { eq, and, count } from 'drizzle-orm';
import { addDays, addHours, format } from 'date-fns';
import { ContractEventManager } from '../subscription/contract-event.manager';
import { MembershipEventPublisher } from '../membership-event.publisher';
import { DrizzleTransaction } from '../../shared/schemas/types';

const DUNNING_MAX_ATTEMPTS = 3;
const DUNNING_RETRY_HOURS = 72; // 3일 후 재시도

@Injectable()
export class BillingOutcomeHandler {
  private readonly logger = new Logger(BillingOutcomeHandler.name);

  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly contractEventManager: ContractEventManager,
    private readonly membershipEventPublisher: MembershipEventPublisher,
  ) {}

  async handleSuccess(contractId: string, amount: number | null, paymentIntentId?: string): Promise<void> {
    const renewedUserId = await this.dbService.db.transaction(async (tx) => {
      const row = await this.getContractWithPlan(tx, contractId);
      if (!row) {
        this.logger.warn(`handleSuccess: contract not found (${contractId})`);
        return null;
      }

      const [countRow] = await tx
        .select({ count: count() })
        .from(schema.billingEvents)
        .where(eq(schema.billingEvents.contractId, contractId));
      const attemptNo = Number(countRow?.count ?? 0) + 1;

      // 멱등 마커(첫 쓰기): unique(contract_id, payment_intent_id, event_type) 충돌 시 0행 → 이미 처리됨.
      // 활성 권한 유무와 무관하게 먼저 기록한다 — 결제는 이미 wallet에서 캡처됐으므로 CHARGE_SUCCESS는
      // 사실이고, 권한이 없어 연장을 못 하더라도 재전달이 중복 처리되면 안 된다.
      const inserted = await tx
        .insert(schema.billingEvents)
        .values({ contractId, eventType: 'CHARGE_SUCCESS', attemptNo, amount, paymentIntentId: paymentIntentId ?? null })
        .onConflictDoNothing()
        .returning({ id: schema.billingEvents.id });
      if (paymentIntentId && inserted.length === 0) {
        this.logger.log(`handleSuccess: already processed intent (${paymentIntentId}) — skip`);
        return null;
      }

      const entitlement = await this.getActiveEntitlement(tx, row.userId);
      if (!entitlement) {
        // 결제는 캡처됐으나 연장할 활성 권한이 없음(가입취소 직후 in-flight 결제 등) → 수동 정산 필요.
        this.logger.error(
          `handleSuccess: 결제 캡처됐으나 활성 권한 없음 — 수동 정산/환불 필요 (userId=${row.userId}, intentId=${paymentIntentId}, amount=${amount})`,
        );
        await tx
          .update(schema.subscriptionContracts)
          .set({ billingInProgress: false, billingStartedAt: null, updatedAt: new Date() })
          .where(eq(schema.subscriptionContracts.id, contractId));
        return null;
      }

      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({ type: 'BILLING_SUCCESS', effectiveDate: format(new Date(), 'yyyy-MM-dd') })
        .returning();

      const oldEndsAt = new Date(entitlement.endsAt);
      const baseDate = oldEndsAt > new Date() ? oldEndsAt : new Date();
      const newEndsAt = addDays(baseDate, row.durationDays);
      const newEndsAtStr = format(newEndsAt, 'yyyy-MM-dd');

      await tx
        .update(schema.subscriptionEntitlement)
        .set({ isCurrent: false, closedAt: new Date(), closedBatchId: batch.id })
        .where(eq(schema.subscriptionEntitlement.id, entitlement.id));

      await tx.insert(schema.subscriptionEntitlement).values({
        userId: row.userId,
        tierId: entitlement.tierId,
        startsAt: entitlement.startsAt,
        endsAt: newEndsAtStr,
        isCurrent: true,
        sourceBatchId: batch.id,
      });

      await tx
        .update(schema.subscriptionContracts)
        .set({
          nextBillingDate: newEndsAtStr,
          billingInProgress: false,
          billingStartedAt: null,
          updatedAt: new Date(),
          // 관리자 강제취소/환불은 contract.lastPaymentIntentId 로 최신 결제를 환불한다. 갱신마다 이 값을
          // 동기화하지 않으면 가입 시점 intent(또는 null)에 고정돼 환불이 과거 결제로 나가거나 아예 안 나간다(Finding 1).
          // 레거시 재전달로 intentId 가 없을 때는 기존 값을 유지한다(null 로 덮어쓰지 않음).
          ...(paymentIntentId ? { lastPaymentIntentId: paymentIntentId } : {}),
        })
        .where(eq(schema.subscriptionContracts.id, contractId));

      await tx.delete(schema.membershipDunningQueue).where(eq(schema.membershipDunningQueue.contractId, contractId));

      await this.contractEventManager.addEvent(
        tx,
        contractId,
        'BILLING_SUCCESS',
        { amount, newEndsAt: newEndsAtStr },
        'SYSTEM',
        row.userId,
        batch.id,
      );

      return row.userId;
    });

    // Medusa 고객 그룹 재동기화 보장 (dunning 중 일시 desync 복구 포함)
    if (renewedUserId) {
      this.membershipEventPublisher
        .publishStatusChanged({
          userId: renewedUserId,
          status: 'ACTIVE',
          occurredAt: new Date().toISOString(),
          contractId,
        })
        .catch((e: unknown) => this.logger.warn(`Kafka 발행 실패 (ACTIVE/renewal): ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  // 결제수단 자체가 없는 경우: 재시도해도 동일 결과이므로 dunning 없이 즉시 해지
  private static readonly NO_PAYMENT_METHOD_ERRORS = new Set([
    'BILLING_AGREEMENT_NOT_FOUND',
    'BILLING_METHOD_NOT_ACTIVE',
  ]);

  async handleFailure(
    contractId: string,
    errorCode: string | null,
    errorMessage: string | null,
    paymentIntentId?: string,
  ): Promise<void> {
    const terminatedUserId = await this.dbService.db.transaction(async (tx) => {
      const [contract] = await tx
        .select({
          userId: schema.subscriptionContracts.userId,
          autoRenewal: schema.subscriptionContracts.autoRenewal,
          recurringCancelledAt: schema.subscriptionContracts.recurringCancelledAt,
          status: schema.subscriptionContracts.status,
        })
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.id, contractId))
        .limit(1);

      if (!contract) return null;

      const [dunning] = await tx
        .select()
        .from(schema.membershipDunningQueue)
        .where(eq(schema.membershipDunningQueue.contractId, contractId))
        .limit(1);

      const nextRetryAt = addHours(new Date(), DUNNING_RETRY_HOURS);
      const attemptNo = dunning ? dunning.attempts + 1 : 1;

      // 멱등 마커(첫 쓰기): unique(contract_id, payment_intent_id, event_type) 충돌 시 0행 → 이미 처리됨.
      // 같은 intent의 실패 이벤트가 재전달돼도 dunning 횟수를 중복 증가시키지 않는다.
      const insertedFail = await tx
        .insert(schema.billingEvents)
        .values({ contractId, eventType: 'CHARGE_FAIL', attemptNo, amount: null, paymentIntentId: paymentIntentId ?? null, errorCode, errorMessage })
        .onConflictDoNothing()
        .returning({ id: schema.billingEvents.id });
      if (paymentIntentId && insertedFail.length === 0) {
        this.logger.log(`handleFailure: already processed intent (${paymentIntentId}) — skip`);
        return null;
      }

      // 해지/종료된 계약의 in-flight 결제 실패는 error-code 무관하게 재청구를 막는다: 선점 해제 + 잔여 dunning
      // 제거 후 현재 주기 자연 만료에 맡긴다. (정기결제 중단: autoRenewal=false/recurringCancelledAt, 즉시·강제
      // 취소: status=CANCELLED/EXPIRED) — 이 가드가 없으면 취소 뒤 도착한 결제 실패가 dunning 을 새로 만들고,
      // dunning 스케줄러(findDunningItems)는 계약 상태를 보지 않아 해지 계약을 재청구한다(Finding 1).
      if (
        !contract.autoRenewal ||
        contract.recurringCancelledAt ||
        contract.status === 'CANCELLED' ||
        contract.status === 'EXPIRED'
      ) {
        this.logger.log(
          `[handleFailure] 해지/종료 계약 결제 실패(${errorCode}) — dunning 생략·큐 정리, 자연 만료: contractId=${contractId}`,
        );
        await tx
          .update(schema.subscriptionContracts)
          .set({ billingInProgress: false, billingStartedAt: null, updatedAt: new Date() })
          .where(eq(schema.subscriptionContracts.id, contractId));
        await tx
          .delete(schema.membershipDunningQueue)
          .where(eq(schema.membershipDunningQueue.contractId, contractId));
        return null;
      }

      // 활성 계약에서 결제수단 부재는 재시도해도 동일 결과 → dunning 없이 즉시 해지.
      // 멱등 마커 뒤에 두어 동시 재전달 시 중복 terminate를 막는다.
      if (errorCode && BillingOutcomeHandler.NO_PAYMENT_METHOD_ERRORS.has(errorCode)) {
        this.logger.log(
          `[handleFailure] 결제수단 없음(${errorCode}) — dunning 생략, 즉시 해지: contractId=${contractId}`,
        );
        await this.terminateSubscription(tx, contractId, contract.userId, errorCode);
        return contract.userId;
      }

      if (!dunning) {
        await tx.insert(schema.membershipDunningQueue).values({
          contractId,
          attempts: 1,
          maxAttempts: DUNNING_MAX_ATTEMPTS,
          nextRetryAt,
          lastErrorCode: errorCode,
          lastErrorMessage: errorMessage,
        });
        await tx
          .update(schema.subscriptionContracts)
          .set({ billingInProgress: false, billingStartedAt: null, updatedAt: new Date() })
          .where(eq(schema.subscriptionContracts.id, contractId));

        await this.recordBillingFailedEvent(tx, contractId, contract.userId, errorCode, 1);
      } else if (dunning.attempts < dunning.maxAttempts) {
        await tx
          .update(schema.membershipDunningQueue)
          .set({
            attempts: attemptNo,
            nextRetryAt,
            lastErrorCode: errorCode,
            lastErrorMessage: errorMessage,
            updatedAt: new Date(),
          })
          .where(eq(schema.membershipDunningQueue.id, dunning.id));
        await tx
          .update(schema.subscriptionContracts)
          .set({ billingInProgress: false, billingStartedAt: null, updatedAt: new Date() })
          .where(eq(schema.subscriptionContracts.id, contractId));

        await this.recordBillingFailedEvent(tx, contractId, contract.userId, errorCode, attemptNo);
      } else {
        this.logger.log(`Dunning max attempts reached for contract ${contractId} — terminating`);
        await this.terminateSubscription(tx, contractId, contract.userId, 'PAYMENT_FAILURE_MAX_ATTEMPTS');
        return contract.userId;
      }

      return null;
    });

    if (terminatedUserId) {
      this.membershipEventPublisher
        .publishStatusChanged({
          userId: terminatedUserId,
          status: 'CANCELLED',
          occurredAt: new Date().toISOString(),
          contractId,
        })
        .catch((e: unknown) => this.logger.warn(`Kafka 발행 실패 (CANCELLED/dunning): ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  async handleExpiration(entitlementId: string, userId: string, contractId: string): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({ type: 'SUBSCRIPTION_EXPIRED', effectiveDate: format(new Date(), 'yyyy-MM-dd') })
        .returning();

      await tx
        .update(schema.subscriptionEntitlement)
        .set({ isCurrent: false, closedAt: new Date(), closedBatchId: batch.id })
        .where(eq(schema.subscriptionEntitlement.id, entitlementId));

      await tx
        .update(schema.subscriptionContracts)
        .set({ status: 'EXPIRED', updatedAt: new Date() })
        .where(eq(schema.subscriptionContracts.id, contractId));

      await this.contractEventManager.addEvent(
        tx,
        contractId,
        'EXPIRED',
        { reason: 'NATURAL_EXPIRATION' },
        'SYSTEM',
        userId,
        batch.id,
      );
    });

    this.membershipEventPublisher
      .publishStatusChanged({ userId, status: 'EXPIRED', occurredAt: new Date().toISOString(), contractId })
      .catch((e: unknown) => this.logger.warn(`Kafka 발행 실패 (EXPIRED): ${e instanceof Error ? e.message : String(e)}`));
  }

  // CMS 정산대기 intent 가 (관리자 취소·만료 등으로) CANCELED 되면 wallet 은 payment.intent.canceled 만
  // 발행한다. 성공/실패와 달리 이 경로는 handleSuccess/handleFailure 를 타지 않으므로, 정기결제 선점
  // (billingInProgress=true)이 자동으로 풀리지 않아 계약이 이후 스케줄러/만료에서 영구 제외된다(Finding 2).
  // 여기서 선점만 해제하고, 결제수단 문제가 아니므로 dunning/해지는 하지 않는다.
  async handleCanceled(contractId: string, paymentIntentId?: string): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      // 멱등 마커(첫 쓰기): unique(contract_id, payment_intent_id, event_type) 충돌 시 0행 → 이미 처리됨.
      // 성공/실패와 달리 handleCanceled 는 billingInProgress 플래그만 보고 해제하므로, 이 마커가 없으면
      // 옛 intent 의 취소가 재전달됐을 때(그 사이 새 청구가 billingInProgress 를 다시 선점) 새 선점을 잘못
      // 풀어 중복 청구를 부른다. intent 단위로 취소를 한 번만 처리하도록 마커로 막는다(Finding 2).
      const insertedCancel = await tx
        .insert(schema.billingEvents)
        .values({ contractId, eventType: 'CHARGE_CANCELED', amount: null, paymentIntentId: paymentIntentId ?? null })
        .onConflictDoNothing()
        .returning({ id: schema.billingEvents.id });
      if (paymentIntentId && insertedCancel.length === 0) {
        this.logger.log(`handleCanceled: already processed intent (${paymentIntentId}) — skip`);
        return;
      }

      // billingInProgress=true 인 계약만 원자적으로 해제한다. 취소 이벤트가 중복 전달되거나 이미
      // 성공/실패로 해제된 뒤 도착해도 두 번째부터는 0행 → no-op 이 되어 감사 이벤트가 중복되지 않는다.
      const released = await tx
        .update(schema.subscriptionContracts)
        .set({ billingInProgress: false, billingStartedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(schema.subscriptionContracts.id, contractId),
            eq(schema.subscriptionContracts.billingInProgress, true),
          ),
        )
        .returning({ userId: schema.subscriptionContracts.userId });

      if (released.length === 0) {
        this.logger.log(`handleCanceled: 해제할 진행중 청구 없음 — skip (contractId=${contractId})`);
        return;
      }

      await this.contractEventManager.addEvent(
        tx,
        contractId,
        'BILLING_CANCELED',
        { paymentIntentId: paymentIntentId ?? null },
        'SYSTEM',
        released[0].userId,
      );
    });
  }

  private async terminateSubscription(
    tx: DrizzleTransaction,
    contractId: string,
    userId: string,
    reason: string,
  ): Promise<void> {
    const [batch] = await tx
      .insert(schema.eventBatches)
      .values({ type: 'SUBSCRIPTION_TERMINATED', effectiveDate: format(new Date(), 'yyyy-MM-dd') })
      .returning();

    await tx
      .update(schema.subscriptionEntitlement)
      .set({ isCurrent: false, closedAt: new Date(), closedBatchId: batch.id })
      .where(
        and(eq(schema.subscriptionEntitlement.userId, userId), eq(schema.subscriptionEntitlement.isCurrent, true)),
      );

    await tx
      .update(schema.subscriptionContracts)
      .set({
        status: 'CANCELLED',
        cancelledAt: new Date(),
        autoRenewal: false,
        nextBillingDate: null,
        billingInProgress: false,
        billingStartedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.subscriptionContracts.id, contractId));

    await tx.delete(schema.membershipDunningQueue).where(eq(schema.membershipDunningQueue.contractId, contractId));

    await this.contractEventManager.addEvent(tx, contractId, 'TERMINATED', { reason }, 'SYSTEM', userId, batch.id);
  }

  private async recordBillingFailedEvent(
    tx: DrizzleTransaction,
    contractId: string,
    userId: string,
    errorCode: string | null,
    attemptNo: number,
  ): Promise<void> {
    const [batch] = await tx
      .insert(schema.eventBatches)
      .values({ type: 'BILLING_FAILED', effectiveDate: format(new Date(), 'yyyy-MM-dd') })
      .returning();

    await this.contractEventManager.addEvent(
      tx,
      contractId,
      'BILLING_FAILED',
      { errorCode, attemptNo },
      'SYSTEM',
      userId,
      batch.id,
    );
  }

  private async getContractWithPlan(tx: DrizzleTransaction, contractId: string) {
    const [row] = await tx
      .select({
        userId: schema.subscriptionContracts.userId,
        durationDays: schema.plan.durationDays,
      })
      .from(schema.subscriptionContracts)
      .innerJoin(schema.plan, eq(schema.subscriptionContracts.planId, schema.plan.id))
      .where(eq(schema.subscriptionContracts.id, contractId))
      .limit(1);

    return row ?? null;
  }

  private async getActiveEntitlement(tx: DrizzleTransaction, userId: string) {
    const [entitlement] = await tx
      .select()
      .from(schema.subscriptionEntitlement)
      .where(and(eq(schema.subscriptionEntitlement.userId, userId), eq(schema.subscriptionEntitlement.isCurrent, true)))
      .limit(1);

    return entitlement ?? null;
  }
}
