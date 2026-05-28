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

  async handleSuccess(contractId: string, amount: number | null): Promise<void> {
    const renewedUserId = await this.dbService.db.transaction(async (tx) => {
      const row = await this.getContractWithPlan(tx, contractId);
      if (!row) {
        this.logger.warn(`handleSuccess: contract not found (${contractId})`);
        return null;
      }

      const entitlement = await this.getActiveEntitlement(tx, row.userId);
      if (!entitlement) {
        this.logger.warn(
          `handleSuccess: active entitlement not found (userId=${row.userId}) — clearing billingInProgress`,
        );
        await tx
          .update(schema.subscriptionContracts)
          .set({ billingInProgress: false, billingStartedAt: null, updatedAt: new Date() })
          .where(eq(schema.subscriptionContracts.id, contractId));
        return null;
      }

      const [countRow] = await tx
        .select({ count: count() })
        .from(schema.billingEvents)
        .where(eq(schema.billingEvents.contractId, contractId));
      const attemptNo = Number(countRow?.count ?? 0) + 1;

      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({ type: 'BILLING_SUCCESS', effectiveDate: format(new Date(), 'yyyy-MM-dd') })
        .returning();

      await tx.insert(schema.billingEvents).values({
        contractId,
        eventType: 'CHARGE_SUCCESS',
        attemptNo,
        amount,
      });

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
        .set({ nextBillingDate: newEndsAtStr, billingInProgress: false, billingStartedAt: null, updatedAt: new Date() })
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

  async handleFailure(contractId: string, errorCode: string | null, errorMessage: string | null): Promise<void> {
    const terminatedUserId = await this.dbService.db.transaction(async (tx) => {
      const [contract] = await tx
        .select({ userId: schema.subscriptionContracts.userId })
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.id, contractId))
        .limit(1);

      if (!contract) return null;

      if (errorCode && BillingOutcomeHandler.NO_PAYMENT_METHOD_ERRORS.has(errorCode)) {
        this.logger.log(
          `[handleFailure] 결제수단 없음(${errorCode}) — dunning 생략, 즉시 해지: contractId=${contractId}`,
        );
        await this.terminateSubscription(tx, contractId, contract.userId, errorCode);
        return contract.userId;
      }

      const [dunning] = await tx
        .select()
        .from(schema.membershipDunningQueue)
        .where(eq(schema.membershipDunningQueue.contractId, contractId))
        .limit(1);

      const nextRetryAt = addHours(new Date(), DUNNING_RETRY_HOURS);

      if (!dunning) {
        await tx.insert(schema.billingEvents).values({
          contractId,
          eventType: 'CHARGE_FAIL',
          attemptNo: 1,
          amount: null,
          errorCode,
          errorMessage,
        });
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
        const newAttempts = dunning.attempts + 1;
        await tx.insert(schema.billingEvents).values({
          contractId,
          eventType: 'CHARGE_FAIL',
          attemptNo: newAttempts,
          amount: null,
          errorCode,
          errorMessage,
        });
        await tx
          .update(schema.membershipDunningQueue)
          .set({
            attempts: newAttempts,
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

        await this.recordBillingFailedEvent(tx, contractId, contract.userId, errorCode, newAttempts);
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
