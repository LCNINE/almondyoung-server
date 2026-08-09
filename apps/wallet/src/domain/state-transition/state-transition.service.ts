import { ConflictException, Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, sql } from 'drizzle-orm';
import {
  WalletSchema,
  charges,
  paymentIntents,
  paymentStateTransitions,
  refunds,
  ChargeStatus,
  PaymentIntentStatus,
  PaymentStateEntityType,
  PaymentStateTriggerType,
  RefundStatus,
} from '../../schema';
import { InjectPublisher, PublisherFor } from '@app/events';
import { PAYMENT_STREAM } from '@packages/event-contracts/streams';
import { DbTx } from '../../types';
import { inTx } from '../../database/tx.util';
import { assertTransitionAllowed } from './state-transition.rules';
import {
  WalletOutboxAppendInput,
  isGatewayRefundAppend,
  isPaymentIntentAppend,
} from '../../messaging/wallet-outbox.types';

type TransitionTargetStatus = PaymentIntentStatus | ChargeStatus | RefundStatus;

interface TransitionContext {
  reasonCode?: string;
  reasonMessage?: string;
  triggeredByType?: PaymentStateTriggerType;
  triggeredById?: string;
  correlationId: string;
  causationId?: string;
  payload?: Record<string, unknown>;
  outboxEvent?: WalletOutboxAppendInput;
  expectedVersion?: number;
}

interface TransitionResult<TStatus extends TransitionTargetStatus> {
  entityId: string;
  previousStatus: TStatus;
  newStatus: TStatus;
}

@Injectable()
export class StateTransitionService {
  constructor(
    private readonly dbService: DbService<WalletSchema>,
    @InjectPublisher(PAYMENT_STREAM)
    private readonly publisher: PublisherFor<typeof PAYMENT_STREAM>,
  ) {}

  async transitionIntent(
    intentId: string,
    toStatus: PaymentIntentStatus,
    context: TransitionContext,
    fromStatus?: PaymentIntentStatus,
    tx?: DbTx,
  ): Promise<TransitionResult<PaymentIntentStatus>> {
    return inTx(
      this.dbService,
      async (trx) => {
        const row = await this.lockIntent(intentId, trx);
        if (!row) {
          throw new Error(`INTENT_NOT_FOUND: ${intentId}`);
        }

        if (fromStatus && row.status !== fromStatus) {
          throw this.buildStatusMismatchConflict('INTENT', intentId, fromStatus, row.status);
        }

        this.assertExpectedVersion('INTENT', intentId, context.expectedVersion, row.version);
        assertTransitionAllowed('INTENT', row.status, toStatus);

        await trx
          .update(paymentIntents)
          .set({
            status: toStatus,
            version: sql`${paymentIntents.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(paymentIntents.id, intentId));

        await this.appendTransition('INTENT', intentId, row.status, toStatus, context, trx);
        await this.appendOutboxIfNeeded(context, trx);

        return { entityId: intentId, previousStatus: row.status, newStatus: toStatus };
      },
      tx,
    );
  }

  async transitionCharge(
    chargeId: string,
    toStatus: ChargeStatus,
    context: TransitionContext,
    fromStatus?: ChargeStatus,
    tx?: DbTx,
  ): Promise<TransitionResult<ChargeStatus>> {
    return inTx(
      this.dbService,
      async (trx) => {
        const row = await this.lockCharge(chargeId, trx);
        if (!row) {
          throw new Error(`CHARGE_NOT_FOUND: ${chargeId}`);
        }

        if (fromStatus && row.status !== fromStatus) {
          throw this.buildStatusMismatchConflict('CHARGE', chargeId, fromStatus, row.status);
        }

        assertTransitionAllowed('CHARGE', row.status, toStatus);

        await trx
          .update(charges)
          .set({
            status: toStatus,
            updatedAt: new Date(),
          })
          .where(eq(charges.id, chargeId));

        await this.appendTransition('CHARGE', chargeId, row.status, toStatus, context, trx);
        await this.appendOutboxIfNeeded(context, trx);

        return { entityId: chargeId, previousStatus: row.status, newStatus: toStatus };
      },
      tx,
    );
  }

  async transitionRefund(
    refundId: string,
    toStatus: RefundStatus,
    context: TransitionContext,
    fromStatus?: RefundStatus,
    tx?: DbTx,
  ): Promise<TransitionResult<RefundStatus>> {
    return inTx(
      this.dbService,
      async (trx) => {
        const row = await this.lockRefund(refundId, trx);
        if (!row) {
          throw new Error(`REFUND_NOT_FOUND: ${refundId}`);
        }

        if (fromStatus && row.status !== fromStatus) {
          throw this.buildStatusMismatchConflict('REFUND', refundId, fromStatus, row.status);
        }

        assertTransitionAllowed('REFUND', row.status, toStatus);

        await trx
          .update(refunds)
          .set({
            status: toStatus,
            updatedAt: new Date(),
          })
          .where(eq(refunds.id, refundId));

        await this.appendTransition('REFUND', refundId, row.status, toStatus, context, trx);
        await this.appendOutboxIfNeeded(context, trx);

        return { entityId: refundId, previousStatus: row.status, newStatus: toStatus };
      },
      tx,
    );
  }

  private async appendTransition(
    entityType: PaymentStateEntityType,
    entityId: string,
    previousStatus: string,
    newStatus: string,
    context: TransitionContext,
    tx: DbTx,
  ): Promise<void> {
    await tx.insert(paymentStateTransitions).values({
      entityType,
      entityId,
      previousStatus,
      newStatus,
      reasonCode: context.reasonCode,
      reasonMessage: context.reasonMessage,
      triggeredByType: context.triggeredByType ?? 'SYSTEM',
      triggeredById: context.triggeredById,
      correlationId: context.correlationId,
      causationId: context.causationId,
      occurredAt: new Date(),
      payload: context.payload ?? null,
    });
  }

  /**
   * 상태 전이와 **같은 트랜잭션**에 아웃박스 행을 남긴다 (ADR-0029 §5-1, Task 6-C-3).
   *
   * 적재 대상이 wallet 자체 `public.outbox_events` 에서 공용 `event.outbox_events` 로 바뀌었다.
   * 눈에 보이는 차이는 **검증 시점**이다 — 전에는 `buildOutboxInsertValues` 가 문자열 필드
   * 유무만 확인하고 행을 넣었고, 계약 위반은 발행 시점(`publishStoredEnvelope`)에야 드러나
   * poison row 로 남았다. 이제 `enqueue` 가 zod 를 먼저 태우므로 위반이 **이 트랜잭션을**
   * 실패시킨다 — 진단 위치가 원인에 붙는다.
   *
   * 계열마다 payload 타입이 달라 분기한다. `payment.intent.*` 9종과 `gateway.refund.*` 2종은
   * 각각 계열 안에서 payload 타입이 하나라, 계열만 좁히면 `enqueue<K>` 의 도출이 캐스팅 없이
   * 통과한다.
   */
  private async appendOutboxIfNeeded(context: TransitionContext, tx: DbTx): Promise<void> {
    const event = context.outboxEvent;
    if (!event) {
      return;
    }

    const common = {
      aggregateId: event.aggregateId,
      partitionKey: event.partitionKey ?? event.aggregateId,
      ...(event.idempotencyKey ? { idempotencyKey: event.idempotencyKey } : {}),
    };

    if (isPaymentIntentAppend(event)) {
      await this.publisher.enqueue({ eventType: event.eventType, payload: event.payload, ...common }, tx);
      return;
    }

    if (isGatewayRefundAppend(event)) {
      await this.publisher.enqueue({ eventType: event.eventType, payload: event.payload, ...common }, tx);
      return;
    }

    // 유니온이 두 계열뿐이라 여기 도달할 수 없다. 계열이 늘면 `never` 가 컴파일에서 걸린다 —
    // 조용히 이벤트를 버리는 분기를 남기지 않기 위한 소진 검사다.
    const unreachable: never = event;
    throw new Error(`Unhandled wallet outbox event: ${JSON.stringify(unreachable)}`);
  }

  private async lockIntent(
    intentId: string,
    tx: DbTx,
  ): Promise<{ status: PaymentIntentStatus; version: number } | null> {
    const rows = (await tx.execute(sql`
      select status, version
      from payment_intents
      where id = ${intentId}
      for update
    `)) as Array<{ status: PaymentIntentStatus; version: number }>;
    return rows[0] ?? null;
  }

  private async lockCharge(chargeId: string, tx: DbTx): Promise<{ status: ChargeStatus } | null> {
    const rows = (await tx.execute(sql`
      select status
      from charges
      where id = ${chargeId}
      for update
    `)) as Array<{ status: ChargeStatus }>;
    return rows[0] ?? null;
  }

  private async lockRefund(refundId: string, tx: DbTx): Promise<{ status: RefundStatus } | null> {
    const rows = (await tx.execute(sql`
      select status
      from refunds
      where id = ${refundId}
      for update
    `)) as Array<{ status: RefundStatus }>;
    return rows[0] ?? null;
  }

  private assertExpectedVersion(
    entityType: 'INTENT',
    entityId: string,
    expectedVersion: number | undefined,
    actualVersion: number,
  ): void {
    if (expectedVersion === undefined) return;

    if (actualVersion !== expectedVersion) {
      throw new ConflictException({
        error: 'OPTIMISTIC_LOCK_CONFLICT',
        message: `${entityType} version mismatch: expected=${expectedVersion}, actual=${actualVersion}, id=${entityId}`,
      });
    }
  }

  private buildStatusMismatchConflict(
    entityType: PaymentStateEntityType,
    entityId: string,
    expectedStatus: string,
    actualStatus: string,
  ): ConflictException {
    return new ConflictException({
      error: 'STATE_STATUS_MISMATCH',
      message: `${entityType} status mismatch: expected=${expectedStatus}, actual=${actualStatus}, id=${entityId}`,
    });
  }
}
