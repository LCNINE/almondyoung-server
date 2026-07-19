import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { eq, and } from 'drizzle-orm';
import { format } from 'date-fns';
import { ContractEventManager } from '../subscription/contract-event.manager';
import { MembershipEventPublisher } from '../membership-event.publisher';
import { DrizzleTransaction } from '../../shared/schemas/types';

/**
 * wallet 인보이스 결과 이벤트의 자격 연장/회수(ADR-0027 §4-2). 더닝/락은 다루지 않는다.
 * 멱등 마커는 billing_events 유니크를 재사용하되 paymentIntentId 자리에 인보이스/시도 키를 기록.
 */
@Injectable()
export class InvoiceOutcomeHandler {
  private readonly logger = new Logger(InvoiceOutcomeHandler.name);

  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly contractEventManager: ContractEventManager,
    private readonly membershipEventPublisher: MembershipEventPublisher,
  ) {}

  /** invoice.paid — 자격을 periodEnd 까지 보장(선적용으로 이미 연장돼 있으면 no-op) + 다음 주기 예약. */
  async handlePaid(
    contractId: string,
    invoiceId: string,
    periodEnd: string,
    amount: number | null,
    intentId?: string,
  ): Promise<void> {
    const renewedUserId = await this.dbService.db.transaction(async (tx) => {
      const contract = await this.getContract(tx, contractId);
      if (!contract) return null;
      if (contract.billingPath !== 'INVOICE') {
        this.logger.warn(`handlePaid: 인보이스 경로 계약이 아님 — skip (contractId=${contractId})`);
        return null;
      }

      const marked = await this.insertMarker(tx, contractId, invoiceId, 'CHARGE_SUCCESS', amount, null, null);
      if (!marked) return null;

      // 취소/만료된 계약의 in-flight 정산 성공: 결제 기록만 남기고 자격을 되살리지 않는다(수동 환불 검토 대상).
      if (contract.status === 'CANCELLED' || contract.status === 'EXPIRED') {
        this.logger.error(
          `handlePaid: 종료된 계약에 정산 성공 도착 — 수동 환불/정산 검토 필요 (contractId=${contractId}, invoiceId=${invoiceId}, amount=${amount}, intentId=${intentId ?? '-'})`,
        );
        await this.contractEventManager.addEvent(
          tx,
          contractId,
          'BILLING_SUCCESS_AFTER_TERMINATION',
          { invoiceId, amount, periodEnd, intentId: intentId ?? null },
          'SYSTEM',
          contract.userId,
        );
        return null;
      }

      // 선적용(INVOICE_ADVANCE_GRANT)이 이미 연장했어도, 이벤트 유실/순서역전 대비로 보장 연장한다.
      await this.ensureEntitlementCovers(tx, contract.userId, periodEnd, 'BILLING_SUCCESS', contractId);

      // 전진만 허용 — 일시정지 재개가 민 nextBillingDate 를 과거 periodEnd 로 되감으면 조기 과금.
      const shouldAdvanceNextBilling =
        contract.autoRenewal && (!contract.nextBillingDate || contract.nextBillingDate < periodEnd);

      await tx
        .update(schema.subscriptionContracts)
        .set({
          // 정기해지 예약(autoRenewal=false) 계약은 취소 경로가 비워둔 nextBillingDate=null 을 유지 —
          // 되살리면 다음 청구가 있는 것처럼 보인다. 잔여기간 자격 연장은 그대로 수행.
          ...(shouldAdvanceNextBilling ? { nextBillingDate: periodEnd } : {}),
          isPastDue: false,
          updatedAt: new Date(),
          // 관리자 강제취소/환불이 최신 결제를 참조한다 — 성공 시도 intent 로 동기화.
          ...(intentId ? { lastPaymentIntentId: intentId } : {}),
        })
        .where(eq(schema.subscriptionContracts.id, contractId));

      await this.contractEventManager.addEvent(
        tx,
        contractId,
        'BILLING_SUCCESS',
        { invoiceId, amount, periodEnd },
        'SYSTEM',
        contract.userId,
      );

      return contract.userId;
    });

    if (renewedUserId) {
      this.membershipEventPublisher
        .publishStatusChanged({
          userId: renewedUserId,
          status: 'ACTIVE',
          occurredAt: new Date().toISOString(),
          contractId,
        })
        .catch((e: unknown) =>
          this.logger.warn(`Kafka 발행 실패 (ACTIVE/invoice.paid): ${e instanceof Error ? e.message : String(e)}`),
        );
    }
  }

  /**
   * invoice.payment_failed — 재시도는 wallet 이 진행 중(터미널 아님). 자격은 유지하고(선적용)
   * 고객 노출용 연체 플래그만 세운다. 멱등 마커는 시도 intent 단위.
   */
  async handlePaymentFailed(
    contractId: string,
    invoiceId: string,
    intentId: string | null,
    attemptCount: number,
    errorCode: string | null,
    errorMessage: string | null,
  ): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      const contract = await this.getContract(tx, contractId);
      if (!contract) return;

      const markerKey = intentId ?? `${invoiceId}:attempt:${attemptCount}`;
      const marked = await this.insertMarker(tx, contractId, markerKey, 'CHARGE_FAIL', null, errorCode, errorMessage);
      if (!marked) return;

      // 종료된 계약에 연체 표시를 되살리지 않는다 — 기록(마커/이벤트)만 남긴다.
      if (contract.status !== 'CANCELLED' && contract.status !== 'EXPIRED') {
        await tx
          .update(schema.subscriptionContracts)
          .set({ isPastDue: true, updatedAt: new Date() })
          .where(eq(schema.subscriptionContracts.id, contractId));
      }

      await this.contractEventManager.addEvent(
        tx,
        contractId,
        'BILLING_FAILED',
        { invoiceId, attemptNo: attemptCount, errorCode },
        'SYSTEM',
        contract.userId,
      );
    });
  }

  /** invoice.uncollectible — 재시도 소진, 최종 미수(터미널) → 자격 회수(해지). */
  async handleUncollectible(contractId: string, invoiceId: string, errorCode: string | null): Promise<void> {
    await this.terminateForInvoiceOutcome(contractId, invoiceId, 'CHARGE_FAIL', `UNCOLLECTIBLE:${errorCode ?? '-'}`);
  }

  /** invoice.voided(명시 intent 취소) — 청구가 소멸했으므로 선적용 자격을 회수한다. */
  async handleVoided(contractId: string, invoiceId: string, reason: string | null): Promise<void> {
    await this.terminateForInvoiceOutcome(contractId, invoiceId, 'CHARGE_CANCELED', `INVOICE_VOIDED:${reason ?? '-'}`);
  }

  /** mandate.rejected — 계좌 심사 최종 거절. 선적용 자격 회수(invoiceId 없으면 계약 단위 1회). */
  async handleMandateRejected(contractId: string, invoiceId: string | null, reasonCode: string | null): Promise<void> {
    await this.terminateForInvoiceOutcome(
      contractId,
      invoiceId ?? `mandate-rejected:${contractId}`,
      'CHARGE_CANCELED',
      `MANDATE_REJECTED:${reasonCode ?? '-'}`,
    );
  }

  /** 인보이스 터미널 실패의 공통 회수 경로 — 자격 종료 + 계약 해지(레거시 terminate 와 동일 효과). */
  private async terminateForInvoiceOutcome(
    contractId: string,
    markerKey: string,
    markerType: string,
    reason: string,
  ): Promise<void> {
    const terminatedUserId = await this.dbService.db.transaction(async (tx) => {
      const contract = await this.getContract(tx, contractId);
      if (!contract) return null;

      const marked = await this.insertMarker(tx, contractId, markerKey, markerType, null, reason, null);
      if (!marked) return null;

      // 이미 해지/만료된 계약이면 자격 회수만 중복하지 않도록 종료.
      if (contract.status === 'CANCELLED' || contract.status === 'EXPIRED') {
        this.logger.log(`[invoice-outcome] 이미 종료된 계약 — skip terminate (contractId=${contractId})`);
        return null;
      }

      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({ type: 'SUBSCRIPTION_TERMINATED', effectiveDate: format(new Date(), 'yyyy-MM-dd') })
        .returning();

      await tx
        .update(schema.subscriptionEntitlement)
        .set({ isCurrent: false, closedAt: new Date(), closedBatchId: batch.id })
        .where(
          and(
            eq(schema.subscriptionEntitlement.userId, contract.userId),
            eq(schema.subscriptionEntitlement.isCurrent, true),
          ),
        );

      await tx
        .update(schema.subscriptionContracts)
        .set({
          status: 'CANCELLED',
          cancelledAt: new Date(),
          autoRenewal: false,
          nextBillingDate: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.subscriptionContracts.id, contractId));

      await this.contractEventManager.addEvent(
        tx,
        contractId,
        'TERMINATED',
        { reason },
        'SYSTEM',
        contract.userId,
        batch.id,
      );

      this.logger.warn(`[invoice-outcome] 자격 회수/해지: contractId=${contractId}, reason=${reason}`);
      return contract.userId;
    });

    if (terminatedUserId) {
      this.membershipEventPublisher
        .publishStatusChanged({
          userId: terminatedUserId,
          status: 'CANCELLED',
          occurredAt: new Date().toISOString(),
          contractId,
        })
        .catch((e: unknown) =>
          this.logger.warn(`Kafka 발행 실패 (CANCELLED/invoice): ${e instanceof Error ? e.message : String(e)}`),
        );
    }
  }

  /** 자격 endsAt 이 periodEnd 미만이면 periodEnd 로 연장(보장 연장 — 이미 충분하면 no-op). */
  private async ensureEntitlementCovers(
    tx: DrizzleTransaction,
    userId: string,
    periodEnd: string,
    batchType: string,
    contractId: string,
  ): Promise<void> {
    const [entitlement] = await tx
      .select()
      .from(schema.subscriptionEntitlement)
      .where(and(eq(schema.subscriptionEntitlement.userId, userId), eq(schema.subscriptionEntitlement.isCurrent, true)))
      .for('update');

    if (!entitlement) {
      this.logger.error(
        `[invoice-outcome] 결제 확정됐으나 활성 자격 없음 — 수동 정산 필요 (userId=${userId}, contractId=${contractId})`,
      );
      return;
    }
    if (entitlement.endsAt >= periodEnd) return;

    const [batch] = await tx
      .insert(schema.eventBatches)
      .values({ type: batchType, effectiveDate: format(new Date(), 'yyyy-MM-dd') })
      .returning();

    await tx
      .update(schema.subscriptionEntitlement)
      .set({ isCurrent: false, closedAt: new Date(), closedBatchId: batch.id })
      .where(eq(schema.subscriptionEntitlement.id, entitlement.id));

    await tx.insert(schema.subscriptionEntitlement).values({
      userId,
      tierId: entitlement.tierId,
      startsAt: entitlement.startsAt,
      endsAt: periodEnd,
      isCurrent: true,
      sourceBatchId: batch.id,
      pausedAt: entitlement.pausedAt,
    });
  }

  /** billing_events 멱등 마커 — 유니크 충돌 시 0행 = 이미 처리됨. */
  private async insertMarker(
    tx: DrizzleTransaction,
    contractId: string,
    markerKey: string,
    eventType: string,
    amount: number | null,
    errorCode: string | null,
    errorMessage: string | null,
  ): Promise<boolean> {
    const inserted = await tx
      .insert(schema.billingEvents)
      .values({ contractId, eventType, amount, paymentIntentId: markerKey, errorCode, errorMessage })
      .onConflictDoNothing({
        target: [schema.billingEvents.contractId, schema.billingEvents.paymentIntentId, schema.billingEvents.eventType],
      })
      .returning({ id: schema.billingEvents.id });
    if (inserted.length === 0) {
      this.logger.log(`[invoice-outcome] already processed (${eventType}, key=${markerKey}) — skip`);
      return false;
    }
    return true;
  }

  private async getContract(tx: DrizzleTransaction, contractId: string) {
    const [contract] = await tx
      .select({
        userId: schema.subscriptionContracts.userId,
        status: schema.subscriptionContracts.status,
        autoRenewal: schema.subscriptionContracts.autoRenewal,
        billingPath: schema.subscriptionContracts.billingPath,
        nextBillingDate: schema.subscriptionContracts.nextBillingDate,
      })
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.id, contractId))
      .limit(1);
    if (!contract) {
      this.logger.warn(`[invoice-outcome] contract not found (${contractId})`);
      return null;
    }
    return contract;
  }
}
