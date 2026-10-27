import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { InjectPublisher, PublisherFor } from '@app/events';
import { ConflictError, NotFoundError } from '@app/shared';
import { CHANNEL_ORDERS_COMMAND_STREAM, CORE_ORDER_STREAM } from '@packages/event-contracts/streams';
import type {
  ChannelReturnSettledPayload,
  ChannelReturnSettlementFailedPayload,
} from '@packages/event-contracts/streams/orders.stream';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { enqueueSalesOrderClaimProgress } from '../common/claim-progress';
import { enqueueSalesOrderReturned } from '../common/sales-order-returned';
import { transitionCustomerReturn } from './customer-return-transition';
import { enqueueSettleChannelReturn, toSettleItems } from './customer-return-settle-command';
import type {
  CustomerReturn,
  CustomerReturnSettlement,
  CustomerReturnSettlementOutcome,
} from './customer-return.types';

/** 마지막 발행 뒤 이만큼 지나도 결과가 없으면 같은 정산 명령을 다시 낸다(N9) */
export const CUSTOMER_RETURN_SETTLEMENT_RETRY_MS = 5 * 60_000;
/** 이만큼 내고도(약 1시간) 안 끝나면 `stalled` 로 멈춘다 — 사람 일이다(N9) */
export const CUSTOMER_RETURN_SETTLEMENT_MAX_ISSUES = 12;
/** 한 틱에 훑는 반품 수의 상한. 넘친 분은 다음 틱이 가져간다 */
const REISSUE_BATCH = 100;

/** 정산 결과를 기다리는 상태 — 검수가 명령을 냈고(inspected) 수령만 확정됐을(refund_pending) 수 있다 */
const SETTLING_STATUSES = ['inspected', 'refund_pending'] as const;

/**
 * 반품 정산 결과를 기록에 옮기고, 결과가 오지 않는 정산 명령을 다시 낸다 (K8 PR6).
 * 성공(`ChannelReturnSettled`)은 반품을 닫고 고객 «반품 완료»·`SalesOrderReturned` 를 같은 트랜잭션에 싣는다.
 * 실패(`ChannelReturnSettlementFailed`)는 순서 없이 와도 `at` 이 더 늦은 것만 적는다(N17).
 */
@Injectable()
export class CustomerReturnSettlementManager {
  private readonly logger = new Logger(CustomerReturnSettlementManager.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    @InjectPublisher(CORE_ORDER_STREAM)
    private readonly coreOrders: PublisherFor<typeof CORE_ORDER_STREAM>,
    @InjectPublisher(CHANNEL_ORDERS_COMMAND_STREAM)
    private readonly commands: PublisherFor<typeof CHANNEL_ORDERS_COMMAND_STREAM>,
  ) {}

  async recordSettled(fact: ChannelReturnSettledPayload, tx?: DbTx): Promise<{ changed: boolean }> {
    return this.dbService.run(async (trx) => {
      const record = await this.lockByChannelReturnId(trx, fact.returnId);
      if (record.status === 'settled') return { changed: false };

      const settledAt = new Date(fact.settledAt);
      const outcome: CustomerReturnSettlementOutcome = {
        refundAmount: fact.refundAmount,
        deduction: fact.deduction,
        feeNotAdjusted: fact.feeNotAdjusted,
        refundMode: fact.refundMode,
        settledAt: fact.settledAt,
      };
      const moved = await transitionCustomerReturn(trx, {
        id: record.id,
        from: SETTLING_STATUSES,
        to: 'settled',
        // 진행 기록은 이력으로 남긴다(시작·발행 수) — 상태만 done
        set: {
          settledAt,
          settlementOutcome: outcome,
          ...(record.settlement ? { settlement: { ...record.settlement, state: 'done' } } : {}),
        },
      });
      if (!moved) {
        // 검수 전·보류·취소된 반품의 정산 성공 — 어긋난 일이다. DLQ 에 남겨 사람이 본다
        throw new ConflictError(
          `Cannot settle customer return ${record.id} (channel ${fact.returnId}): status is ${record.status}`,
        );
      }

      await enqueueSalesOrderClaimProgress(this.coreOrders, trx, {
        salesOrderId: record.salesOrderId,
        kind: 'return',
        stage: 'completed',
        requestId: record.id,
        requestedBy: record.requestedBy === 'operator' ? 'admin' : 'customer',
        occurredAt: settledAt,
      });
      await enqueueSalesOrderReturned(this.coreOrders, trx, {
        salesOrderId: record.salesOrderId,
        returnRequestId: record.id,
        reason: record.reason,
        returnedAt: settledAt,
        lines: await this.loadReturnedLines(trx, record.id),
      });
      return { changed: true };
    }, tx);
  }

  async recordSettlementFailed(fact: ChannelReturnSettlementFailedPayload, tx?: DbTx): Promise<{ changed: boolean }> {
    return this.dbService.run(async (trx) => {
      const record = await this.lockByChannelReturnId(trx, fact.returnId);
      // 이미 닫혔거나(늦은 실패) 정산 중이 아니다
      if (record.status !== 'inspected' && record.status !== 'refund_pending') return { changed: false };
      const previous = record.settlement;
      if (!previous) throw new Error(`Settling customer return ${record.id} has no settlement record`);
      // 순서 없이 온다 — 이미 적힌 실패보다 이른 것은 버린다
      if (previous.lastFailure && Date.parse(fact.at) < Date.parse(previous.lastFailure.at)) {
        return { changed: false };
      }

      const settlement: CustomerReturnSettlement = {
        ...previous,
        state: fact.retryable ? 'in_progress' : 'refused',
        lastFailure: {
          code: fact.failureCode,
          message: fact.message,
          retryable: fact.retryable,
          received: fact.received,
          at: fact.at,
        },
      };
      if (fact.received && record.status === 'inspected') {
        // 수령은 확정됐고 환불만 남았다(N17)
        const moved = await transitionCustomerReturn(trx, {
          id: record.id,
          from: ['inspected'],
          to: 'refund_pending',
          set: { settlement },
        });
        if (!moved) throw new ConflictError(`Customer return ${record.id} changed while recording settlement failure`);
      } else {
        await this.writeSettlement(trx, record.id, settlement);
      }
      return { changed: true };
    }, tx);
  }

  /**
   * 마지막 발행이 `CUSTOMER_RETURN_SETTLEMENT_RETRY_MS` 넘은 정산 중 반품에 같은 명령을 다시 낸다(N9).
   * `for update skip locked` 라 두 태스크가 겹쳐 돌아도 한 행을 두 번 내지 않는다. 재발행한 수를 돌려준다.
   * 영구 거절(`refused`)·멈춤(`stalled`)·닫힘(`done`)은 고르지 않는다.
   */
  async reissueStalled(now: Date, tx?: DbTx): Promise<number> {
    return this.dbService.run(async (trx) => {
      const cr = wmsTables.customerReturns;
      // raw sql 에 Date 를 넘기지 않는다(postgres.js 가 직렬화하지 못한다) — ISO 문자열로
      const cutoff = new Date(now.getTime() - CUSTOMER_RETURN_SETTLEMENT_RETRY_MS).toISOString();
      const due = await trx
        .select()
        .from(cr)
        .where(
          and(
            inArray(cr.status, [...SETTLING_STATUSES]),
            sql`${cr.settlement}->>'state' = 'in_progress'`,
            sql`(${cr.settlement}->>'lastIssuedAt')::timestamptz <= ${cutoff}::timestamptz`,
          ),
        )
        .orderBy(asc(sql`(${cr.settlement}->>'lastIssuedAt')::timestamptz`))
        .limit(REISSUE_BATCH)
        .for('update', { skipLocked: true });

      let reissued = 0;
      for (const record of due) {
        const settlement = record.settlement;
        if (!settlement) continue;
        if (settlement.attempts >= CUSTOMER_RETURN_SETTLEMENT_MAX_ISSUES) {
          await this.writeSettlement(trx, record.id, { ...settlement, state: 'stalled' });
          this.logger.error(
            `[ReturnSettlement] customer return ${record.id} (channel ${record.channelReturnId}) stalled after ` +
              `${settlement.attempts} issues; last failure: ${settlement.lastFailure?.code ?? 'none'}`,
          );
          continue;
        }
        const issue = settlement.attempts + 1;
        await enqueueSettleChannelReturn(this.commands, trx, {
          customerReturnId: record.id,
          salesOrderId: record.salesOrderId,
          channelReturnId: record.channelReturnId,
          items: toSettleItems(await this.loadSettleLines(trx, record.id)),
          refundMode: settlement.refundMode,
          issue,
        });
        await this.writeSettlement(trx, record.id, { ...settlement, attempts: issue, lastIssuedAt: now.toISOString() });
        reissued++;
      }
      return reissued;
    }, tx);
  }

  private async lockByChannelReturnId(trx: DbTx, channelReturnId: string): Promise<CustomerReturn> {
    const [record] = await trx
      .select()
      .from(wmsTables.customerReturns)
      .where(eq(wmsTables.customerReturns.channelReturnId, channelReturnId))
      .for('update');
    if (!record) throw new NotFoundError(`Customer return not found for channel return ${channelReturnId}`);
    return record;
  }

  /** 상태를 바꾸지 않는 정산 칸 쓰기 — 상태는 `transitionCustomerReturn` 만 쓴다 */
  private async writeSettlement(trx: DbTx, id: string, settlement: CustomerReturnSettlement): Promise<void> {
    await trx
      .update(wmsTables.customerReturns)
      .set({ settlement, updatedAt: new Date() })
      .where(eq(wmsTables.customerReturns.id, id));
  }

  /** 반품 줄 — `SalesOrderReturned` 의 라인(라인마다 한 번, 반품 줄은 판매주문 라인당 하나) */
  private async loadReturnedLines(trx: DbTx, customerReturnId: string) {
    const l = wmsTables.customerReturnLines;
    const sol = wmsTables.salesOrderLines;
    return trx
      .select({
        salesOrderLineId: l.salesOrderLineId,
        channelOrderItemId: sol.channelOrderItemId,
        orderedQuantity: sol.quantity,
      })
      .from(l)
      .innerJoin(sol, eq(sol.id, l.salesOrderLineId))
      .where(eq(l.customerReturnId, customerReturnId))
      .orderBy(asc(l.channelOrderItemId));
  }

  /** 검수가 적은 SKU 항목 불량 수량을 줄마다 모은다 — 검수 때와 같은 `toSettleItems` 입력 */
  private async loadSettleLines(trx: DbTx, customerReturnId: string): Promise<Parameters<typeof toSettleItems>[0]> {
    const i = wmsTables.customerReturnItems;
    const l = wmsTables.customerReturnLines;
    const rows = await trx
      .select({
        lineId: l.id,
        channelOrderItemId: l.channelOrderItemId,
        lineQuantity: l.quantity,
        qtyPerUnit: i.qtyPerUnit,
        rejectedQty: i.rejectedQty,
      })
      .from(i)
      .innerJoin(l, eq(l.id, i.customerReturnLineId))
      .where(eq(l.customerReturnId, customerReturnId))
      .orderBy(asc(l.channelOrderItemId), asc(i.skuId));
    const byLine = new Map<string, Parameters<typeof toSettleItems>[0][number]>();
    for (const row of rows) {
      const line = byLine.get(row.lineId) ?? {
        channelOrderItemId: row.channelOrderItemId,
        quantity: row.lineQuantity,
        items: [],
      };
      line.items.push({ qtyPerUnit: row.qtyPerUnit, rejectedQty: row.rejectedQty ?? 0 });
      byLine.set(row.lineId, line);
    }
    return [...byLine.values()];
  }
}
