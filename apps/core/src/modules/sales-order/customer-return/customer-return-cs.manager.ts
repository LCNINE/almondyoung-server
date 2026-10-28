import { Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { InjectPublisher, PublisherFor } from '@app/events';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { CHANNEL_ORDERS_COMMAND_STREAM } from '@packages/event-contracts/streams';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { transitionCustomerReturn } from './customer-return-transition';
import { enqueuePrepayChannelReturn } from './customer-return-prepay-command';
import { enqueueSettleChannelReturn, loadSettleLines, toSettleItems } from './customer-return-settle-command';
import { CustomerReturnReader, CustomerReturnView } from './customer-return.reader';
import { CustomerExchangeReleaser } from './customer-exchange.releaser';
import type {
  CustomerReturn,
  CustomerReturnCsResolution,
  CustomerReturnPrepayment,
  CustomerReturnSettlement,
} from './customer-return.types';

export type ReleaseCustomerExchangeInput = { customerReturnId: string; actorId: string };

export type CloseCustomerReturnMissingInput = { customerReturnId: string; memo: string; actorId: string };

export type SettleHeldCustomerReturnInput = {
  customerReturnId: string;
  /** 보류 차감(원). 0 이면 차감 없이 정산한다(N2) */
  deduction: number;
  memo: string;
  actorId: string;
};

export type RequestCustomerReturnPrepayInput = {
  customerReturnId: string;
  /** null 이면 Medusa 기본값(품목 값 − 택배비 예상, N5) */
  amount: number | null;
  refundMode: 'auto' | 'manual';
  memo: string;
  actorId: string;
};

/** 돈이 나갔거나 나가는 중인 선환불 — 이 반품은 미도착으로 닫지 못한다(N15). 거절·대체된 선환불은 막지 않는다 */
const PREPAY_BLOCKS_CLOSE: ReadonlyArray<CustomerReturnPrepayment['state']> = ['in_progress', 'stalled', 'done'];

/**
 * Medusa 가 선환불 기록을 쓰기 «전»에 거절했다(금액 넘침·미해결 외부 환불 등) — 요청 해시가 아직 없어 새 금액·메모로
 * 다시 요청할 수 있다. wallet 거절(`wallet_refund_refused:*`)은 Medusa 기록이 이미 있어 새 금액이면 request_id_conflict 다
 */
const PREPAY_REJECTED_BEFORE_RECORD_PREFIX = 'return_prepay_rejected:';

const replaceablePrepayment = (p: CustomerReturnPrepayment): boolean =>
  p.state === 'refused' && !!p.lastFailure?.code.startsWith(PREPAY_REJECTED_BEFORE_RECORD_PREFIX);

/**
 * 반품 CS 문 (K8 PR6b) — 미도착 닫기·보류 정산·선환불 요청. 문마다 반품 기록을 옮기고 채널 명령을 같은 트랜잭션에 싣는다(N1).
 * 돈은 Medusa 가 정한다 — 여기는 CS 의 결정(`cs_resolution`)과 명령의 진행(`settlement`·`prepayment`)만 적는다.
 * 같은 반품의 문들과 도착·검수는 `customer_returns` 행 잠금으로 줄을 세운다.
 */
@Injectable()
export class CustomerReturnCsManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly reader: CustomerReturnReader,
    @InjectPublisher(CHANNEL_ORDERS_COMMAND_STREAM)
    private readonly commands: PublisherFor<typeof CHANNEL_ORDERS_COMMAND_STREAM>,
    private readonly exchanges: CustomerExchangeReleaser,
  ) {}

  /**
   * 교환품 보내기(K8 PR11 N14 ②) — 보류(`held`)면 `held → inspected` 로 옮겨 정산 명령(명령 칸 `{}`)을 내고 교환 상자를 연다.
   * 수령 전(`expected`·`arrived`)이면 상자만 연다(«선발송») — 정산은 검수가 낸다. 그 밖의 상태는 409.
   * 이미 열린 교환의 재요청은 그대로 돌려준다 — 단 선발송 뒤 검수가 보류로 멈춘 교환(held)은 정산을 연다. 반품(kind return)은 400.
   */
  async releaseExchange(input: ReleaseCustomerExchangeInput, tx?: DbTx): Promise<CustomerReturnView> {
    return this.dbService.run(async (trx) => {
      const record = await this.lockReturn(trx, input.customerReturnId);
      if (record.kind !== 'exchange') throw new BadRequestError('반품은 교환품을 보내지 않습니다');
      // 열린 교환의 재요청은 그대로 — 단 보류(held)는 아니다: 선발송한 교환도 검수에 보류가 있으면 held 에 멈추고
      // 정산을 여는 문은 이것뿐이다(보류 정산은 교환을 거절한다). held 면 정산을 열고, 상자는 releaser 가 다시 열지 않는다
      if (record.exchangeReleasedAt && record.status !== 'held') return this.reader.findById(record.id, trx);

      if (record.status === 'held') {
        const now = new Date();
        // 교환은 보류 차감·미도착 닫기가 없다(N15) — 명령 칸은 빈 값이다
        const command: NonNullable<CustomerReturnSettlement['command']> = {};
        const settlement: CustomerReturnSettlement = {
          state: 'in_progress',
          refundMode: 'auto',
          startedAt: now.toISOString(),
          lastIssuedAt: now.toISOString(),
          attempts: 1,
          issues: 1,
          lastFailure: null,
          command,
        };
        const moved = await transitionCustomerReturn(trx, {
          id: record.id,
          from: ['held'],
          to: 'inspected',
          set: { settlement },
        });
        if (!moved) throw new ConflictError(`Customer exchange ${record.id} changed while releasing`);
        await enqueueSettleChannelReturn(this.commands, trx, {
          customerReturnId: record.id,
          salesOrderId: record.salesOrderId,
          channelReturnId: record.channelReturnId,
          items: toSettleItems(await loadSettleLines(trx, record.id)),
          refundMode: settlement.refundMode,
          command,
          issue: 1,
        });
      } else if (record.status !== 'expected' && record.status !== 'arrived') {
        throw new ConflictError(`Customer exchange ${record.id} cannot be released: status is ${record.status}`);
      }
      await this.exchanges.release(trx, { customerReturnId: record.id, actorId: input.actorId });
      return this.reader.findById(record.id, trx);
    }, tx);
  }

  /**
   * 미도착 닫기(N8) — 줄마다 온전히 도착한 벌만 남기고 나머지를 `missing_qty` 로 닫는다. 상태는 `arrived` 그대로,
   * 검수가 «합 = 도착»으로 이어 간다. 선환불한 반품은 닫지 못한다(N15).
   */
  async closeMissing(input: CloseCustomerReturnMissingInput, tx?: DbTx): Promise<CustomerReturnView> {
    return this.dbService.run(async (trx) => {
      const record = await this.lockReturn(trx, input.customerReturnId);
      this.assertNotExchange(record, '미도착으로 닫지 않습니다 — 반품 취소로 닫으세요');
      if (record.csResolution?.missing) return this.reader.findById(record.id, trx);
      if (record.status === 'expected') {
        throw new ConflictError('도착한 것이 없습니다 — 반품 취소로 닫으세요');
      }
      if (record.status !== 'arrived') {
        throw new ConflictError(`Customer return ${record.id} cannot close missing items: status is ${record.status}`);
      }
      if (record.prepayment && PREPAY_BLOCKS_CLOSE.includes(record.prepayment.state)) {
        throw new ConflictError('먼저 환불한 반품은 미도착으로 닫을 수 없습니다');
      }
      this.assertMemo(input.memo);

      const lines = await this.completeUnitsByLine(trx, record.id);
      if (lines.every((line) => line.completeUnits === line.quantity)) {
        throw new BadRequestError('모두 도착했습니다 — 검수하세요');
      }
      if (lines.every((line) => line.completeUnits === 0)) {
        throw new BadRequestError('온전히 도착한 벌이 없습니다 — 반품 취소로 닫으세요');
      }

      for (const line of lines) {
        const missingQty = line.quantity - line.completeUnits;
        if (missingQty === 0) continue;
        await trx
          .update(wmsTables.customerReturnLines)
          .set({ missingQty })
          .where(eq(wmsTables.customerReturnLines.id, line.id));
      }
      await this.writeCsResolution(trx, record.id, {
        ...record.csResolution,
        missing: { memo: input.memo, by: input.actorId, at: new Date().toISOString() },
      });
      return this.reader.findById(record.id, trx);
    }, tx);
  }

  /**
   * 보류 정산(N2) — `held → inspected` 로 옮기고 정산 명령을 낸다. 차감이 0 보다 크면 명령에 `holdDeduction`,
   * 미도착을 닫은 반품이면 `closesMissing`. 같은 차감·메모의 재요청은 그대로, 다르면 거절한다.
   */
  async settleHeld(input: SettleHeldCustomerReturnInput, tx?: DbTx): Promise<CustomerReturnView> {
    return this.dbService.run(async (trx) => {
      const record = await this.lockReturn(trx, input.customerReturnId);
      this.assertNotExchange(record, '보류 정산이 없습니다 — [교환품 보내기]로 여세요');
      const prior = record.csResolution?.hold;
      if (prior) {
        if (prior.deduction === input.deduction && prior.memo === input.memo) {
          return this.reader.findById(record.id, trx);
        }
        throw new ConflictError(
          `Customer return ${record.id} was already settled from hold with a different deduction`,
        );
      }
      if (record.status !== 'held') {
        throw new ConflictError(`Customer return ${record.id} is not held: status is ${record.status}`);
      }
      if (!Number.isInteger(input.deduction) || input.deduction < 0) {
        throw new BadRequestError('deduction must be a non-negative integer');
      }
      this.assertMemo(input.memo);

      const now = new Date();
      const command: NonNullable<CustomerReturnSettlement['command']> = {
        ...(input.deduction > 0 ? { holdDeduction: { amount: input.deduction, memo: input.memo } } : {}),
        ...(record.csResolution?.missing ? { closesMissing: true } : {}),
      };
      const settlement: CustomerReturnSettlement = {
        state: 'in_progress',
        refundMode: 'auto',
        startedAt: now.toISOString(),
        lastIssuedAt: now.toISOString(),
        attempts: 1,
        issues: 1,
        lastFailure: null,
        command,
      };
      const moved = await transitionCustomerReturn(trx, {
        id: record.id,
        from: ['held'],
        to: 'inspected',
        set: {
          settlement,
          csResolution: {
            ...record.csResolution,
            hold: { deduction: input.deduction, memo: input.memo, by: input.actorId, at: now.toISOString() },
          },
        },
      });
      if (!moved) throw new ConflictError(`Customer return ${record.id} changed while settling from hold`);
      await enqueueSettleChannelReturn(this.commands, trx, {
        customerReturnId: record.id,
        salesOrderId: record.salesOrderId,
        channelReturnId: record.channelReturnId,
        items: toSettleItems(await loadSettleLines(trx, record.id)),
        refundMode: settlement.refundMode,
        command,
        issue: 1,
      });
      return this.reader.findById(record.id, trx);
    }, tx);
  }

  /**
   * 선환불 요청(N4) — 수령 전 반품(`expected`·`arrived`)에 RETURN 환불을 먼저 낸다. 상태는 바꾸지 않고 선환불 칸만 쓴다.
   * 미도착을 닫은 반품은 받지 않는다(N15). 반품당 한 번 — 같은 금액·메모·환불 방식의 재요청은 그대로, 다르면 거절한다
   * (Medusa 가 금액·메모로 같은 선환불을 잇는다). 단 Medusa 가 기록 전에 거절한 선환불(`return_prepay_rejected:*`)은
   * 새 요청으로 갈아 끼운다 — 발행 세대는 이어(issues + 1) 멱등 키가 겹치지 않는다.
   */
  async requestPrepay(input: RequestCustomerReturnPrepayInput, tx?: DbTx): Promise<CustomerReturnView> {
    return this.dbService.run(async (trx) => {
      const record = await this.lockReturn(trx, input.customerReturnId);
      this.assertNotExchange(record, '먼저 환불하지 않습니다 — 돈이 움직이지 않습니다');
      const prior = record.prepayment;
      const sameRequest = !!prior && prior.requestedAmount === input.amount && prior.memo === input.memo;
      if (prior && sameRequest && prior.refundMode === input.refundMode) {
        return this.reader.findById(record.id, trx);
      }
      if (prior && !replaceablePrepayment(prior)) {
        if (sameRequest) {
          throw new ConflictError(
            `Customer return ${record.id} already has a ${prior.refundMode} prepayment — ` +
              'to switch to a bank transfer, use POST /admin/customer-returns/:id/prepayment/manual-refund once it is refused or stalled',
          );
        }
        throw new ConflictError(
          `Customer return ${record.id} already has a prepayment with a different amount or memo`,
        );
      }
      if (record.status !== 'expected' && record.status !== 'arrived') {
        throw new ConflictError(`Customer return ${record.id} cannot be prepaid: status is ${record.status}`);
      }
      if (record.csResolution?.missing) {
        throw new ConflictError('미도착으로 닫은 반품은 먼저 환불할 수 없습니다');
      }
      if (input.amount !== null && (!Number.isInteger(input.amount) || input.amount < 1)) {
        throw new BadRequestError('amount must be a positive integer');
      }
      this.assertMemo(input.memo);

      const now = new Date().toISOString();
      // 갈아 끼우면 세대를 잇는다 — 옛 발행과 멱등 키가 겹치지 않고, 그 발행의 늦은 실패는 restartedAt 앞이라 버린다
      const issue = (prior?.issues ?? 0) + 1;
      await this.writePrepayment(trx, record.id, {
        state: 'in_progress',
        refundMode: input.refundMode,
        requestedAmount: input.amount,
        memo: input.memo,
        requestedBy: input.actorId,
        startedAt: now,
        lastIssuedAt: now,
        attempts: 1,
        issues: issue,
        lastFailure: null,
        outcome: null,
        ...(prior ? { restartedAt: now, restartedBy: input.actorId } : {}),
      });
      await enqueuePrepayChannelReturn(this.commands, trx, {
        customerReturnId: record.id,
        salesOrderId: record.salesOrderId,
        channelReturnId: record.channelReturnId,
        amount: input.amount,
        refundMode: input.refundMode,
        memo: input.memo,
        issue,
      });
      return this.reader.findById(record.id, trx);
    }, tx);
  }

  private async lockReturn(trx: DbTx, id: string): Promise<CustomerReturn> {
    const [record] = await trx
      .select()
      .from(wmsTables.customerReturns)
      .where(eq(wmsTables.customerReturns.id, id))
      .for('update');
    if (!record) throw new NotFoundError(`Customer return not found: ${id}`);
    return record;
  }

  /** 돈 문(보류 정산·선환불)과 미도착 닫기는 교환을 받지 않는다(K8 PR11 N15) */
  private assertNotExchange(record: CustomerReturn, why: string): void {
    if (record.kind === 'exchange') throw new BadRequestError(`교환은 ${why}`);
  }

  private assertMemo(memo: string): void {
    if (!memo.trim()) throw new BadRequestError('memo is required');
    if (memo.length > 500) throw new BadRequestError('memo must be at most 500 characters');
  }

  /** 상태를 바꾸지 않는 CS 결정 칸 쓰기 — 상태는 `transitionCustomerReturn` 만 쓴다 */
  private async writeCsResolution(trx: DbTx, id: string, csResolution: CustomerReturnCsResolution): Promise<void> {
    await trx
      .update(wmsTables.customerReturns)
      .set({ csResolution, updatedAt: new Date() })
      .where(eq(wmsTables.customerReturns.id, id));
  }

  /** 상태를 바꾸지 않는 선환불 칸 쓰기 — PR 6 `writeSettlement` 꼴 */
  private async writePrepayment(trx: DbTx, id: string, prepayment: CustomerReturnPrepayment): Promise<void> {
    await trx
      .update(wmsTables.customerReturns)
      .set({ prepayment, updatedAt: new Date() })
      .where(eq(wmsTables.customerReturns.id, id));
  }

  /**
   * 줄마다 온전히 도착한 벌 = SKU 항목마다 floor(도착 / 1벌당 수량) 의 최솟값(N8). 도착 합은 따로 group by 로 읽는다
   * (`CustomerReturnReader.itemsOf` 와 같은 이유).
   */
  private async completeUnitsByLine(
    trx: DbTx,
    customerReturnId: string,
  ): Promise<Array<{ id: string; quantity: number; completeUnits: number }>> {
    const l = wmsTables.customerReturnLines;
    const i = wmsTables.customerReturnItems;
    const a = wmsTables.customerReturnArrivals;
    const rows = await trx
      .select({ lineId: l.id, quantity: l.quantity, itemId: i.id, qtyPerUnit: i.qtyPerUnit })
      .from(i)
      .innerJoin(l, eq(l.id, i.customerReturnLineId))
      .where(eq(l.customerReturnId, customerReturnId));
    if (rows.length === 0) throw new Error(`Customer return ${customerReturnId} has no items`);
    const arrived = await trx
      .select({ itemId: a.customerReturnItemId, qty: sql<number>`sum(${a.quantity})::int` })
      .from(a)
      .where(
        inArray(
          a.customerReturnItemId,
          rows.map((row) => row.itemId),
        ),
      )
      .groupBy(a.customerReturnItemId);
    const arrivedByItem = new Map(arrived.map((row) => [row.itemId, row.qty]));

    const byLine = new Map<string, { id: string; quantity: number; completeUnits: number }>();
    for (const row of rows) {
      const units = Math.floor((arrivedByItem.get(row.itemId) ?? 0) / row.qtyPerUnit);
      const line = byLine.get(row.lineId) ?? { id: row.lineId, quantity: row.quantity, completeUnits: row.quantity };
      line.completeUnits = Math.min(line.completeUnits, units);
      byLine.set(row.lineId, line);
    }
    return [...byLine.values()];
  }
}
