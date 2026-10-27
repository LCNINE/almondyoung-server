import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { InjectPublisher, PublisherFor } from '@app/events';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { CHANNEL_ORDERS_COMMAND_STREAM, CORE_ORDER_STREAM } from '@packages/event-contracts/streams';
import type {
  ChannelReturnPrepaidPayload,
  ChannelReturnPrepayFailedPayload,
  ChannelReturnSettledPayload,
  ChannelReturnSettlementFailedPayload,
} from '@packages/event-contracts/streams/orders.stream';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { enqueueSalesOrderClaimProgress } from '../common/claim-progress';
import { enqueueSalesOrderReturned } from '../common/sales-order-returned';
import { transitionCustomerReturn } from './customer-return-transition';
import { enqueuePrepayChannelReturn } from './customer-return-prepay-command';
import { enqueueSettleChannelReturn, loadSettleLines, toSettleItems } from './customer-return-settle-command';
import { CustomerReturnReader, CustomerReturnView } from './customer-return.reader';
import type {
  CustomerReturn,
  CustomerReturnPrepayment,
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
/** 선환불이 열리는 상태 — 수령 전(N7). 정산이 시작되면 선환불은 Medusa 가 줄 세운다 */
const PREPAYABLE_STATUSES = ['expected', 'arrived'] as const;

/** 정산이 먼저 Medusa 에 닿아 선환불이 설 자리가 없다 — 선환불은 `superseded`(N7) */
const PREPAY_SUPERSEDED_CODE = 'return_prepay_rejected:return_already_settled';
/**
 * 외부 환불로 Medusa 가 거절한 정산(unresolved·exceeds·absent) — «이미 환불한 금액»을 적거나 고치거나 지울 수 있는 실패(N10).
 * 셋 다 Medusa 가 수령·기록 «전»에 거절하므로 요청 해시가 아직 없어 바꾼 값으로 다시 낼 수 있다.
 * absent(외부 환불이 없는데 적었다)는 지우기(null)가 유일한 출구다
 */
const EXTERNAL_REFUND_REJECTED_PREFIX = 'return_settle_rejected:external_refund_';

/** 다시 시작하기 «전» 발행의 실패 사실이 늦게 왔다 — 다시 시작한 칸을 그 실패로 되돌리지 않는다(M4) */
const predatesRestart = (at: string, slot: { restartedAt?: string }): boolean =>
  slot.restartedAt !== undefined && Date.parse(at) < Date.parse(slot.restartedAt);

export type RestartCustomerReturnInput = {
  customerReturnId: string;
  /** 다시 낼 칸 — 정산 명령 또는 선환불 명령 */
  target: 'settlement' | 'prepayment';
  /** retry = 같은 방식으로, manual = 계좌 송금(refundMode manual)으로 */
  kind: 'retry' | 'manual';
  /**
   * 정산 다시 시도만, 마지막 실패가 외부 환불 거절(`return_settle_rejected:external_refund_*`)일 때만 — 이미 다른 경로로
   * 돌려준 금액(원). null 이면 저장된 값을 지운다(없음 거절의 출구). undefined 면 저장된 값 그대로
   */
  alreadyRefundedAmount?: number | null;
  actorId: string;
};

/** 명령 진행 칸이 다시 시작할 수 있는가 — 사람 일(refused·stalled)만. 진행 중·닫힘은 거절한다(N10) */
function assertRestartable(
  what: string,
  state: CustomerReturnSettlement['state'] | CustomerReturnPrepayment['state'],
): void {
  if (state === 'in_progress') throw new ConflictError(`${what}이 진행 중입니다 — 결과를 기다리세요`);
  if (state === 'done' || state === 'superseded') throw new ConflictError(`${what}은 이미 끝났습니다`);
}

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
    private readonly reader: CustomerReturnReader,
    @InjectPublisher(CORE_ORDER_STREAM)
    private readonly coreOrders: PublisherFor<typeof CORE_ORDER_STREAM>,
    @InjectPublisher(CHANNEL_ORDERS_COMMAND_STREAM)
    private readonly commands: PublisherFor<typeof CHANNEL_ORDERS_COMMAND_STREAM>,
  ) {}

  async recordSettled(fact: ChannelReturnSettledPayload, tx?: DbTx): Promise<{ changed: boolean }> {
    return this.dbService.run(async (trx) => {
      const record = await this.lockByChannelReturnId(trx, fact.returnId, fact.requestId);
      if (record.status === 'settled') return { changed: false };

      const settledAt = new Date(fact.settledAt);
      const outcome: CustomerReturnSettlementOutcome = {
        refundAmount: fact.refundAmount,
        deduction: fact.deduction,
        feeNotAdjusted: fact.feeNotAdjusted,
        refundMode: fact.refundMode,
        settledAt: fact.settledAt,
        ...(fact.prepaidAmount !== undefined ? { prepaidAmount: fact.prepaidAmount } : {}),
        ...(fact.externalRefundApplied !== undefined ? { externalRefundApplied: fact.externalRefundApplied } : {}),
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
          // 끝나지 않은 선환불은 정산이 대신했다(N7). 정산이 선환불액을 셌다면 결과의 prepaidAmount 에 있다.
          // 잃은 응답의 선환불 성공이 뒤늦게 오면 recordPrepaid 가 done 으로 바꾼다
          ...(record.prepayment && record.prepayment.state !== 'done'
            ? { prepayment: { ...record.prepayment, state: 'superseded' } }
            : {}),
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
      const record = await this.lockByChannelReturnId(trx, fact.returnId, fact.requestId);
      // 이미 닫혔거나(늦은 실패) 정산 중이 아니다
      if (record.status !== 'inspected' && record.status !== 'refund_pending') return { changed: false };
      const previous = record.settlement;
      if (!previous) throw new Error(`Settling customer return ${record.id} has no settlement record`);
      // 순서 없이 온다 — 이미 적힌 실패보다 이른 것, 다시 시작하기 전 발행의 실패는 버린다
      if (previous.lastFailure && Date.parse(fact.at) < Date.parse(previous.lastFailure.at)) {
        return { changed: false };
      }
      if (predatesRestart(fact.at, previous)) return { changed: false };

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
   * 선환불 성공(K8 PR6b). 반품 상태와 무관하게 받는다 — 정산 뒤 잃은 응답의 재시도에도 Medusa 는 200(장부 합)으로 답해
   * 정산이 `superseded` 로 둔 선환불에 성공이 뒤늦게 올 수 있다. 이미 `done` 이면 그대로.
   */
  async recordPrepaid(fact: ChannelReturnPrepaidPayload, tx?: DbTx): Promise<{ changed: boolean }> {
    return this.dbService.run(async (trx) => {
      const record = await this.lockByChannelReturnId(trx, fact.returnId, fact.requestId);
      const previous = record.prepayment;
      if (!previous) {
        throw new ConflictError(`Prepaid fact for customer return ${record.id}, which has no prepayment`);
      }
      if (previous.state === 'done') return { changed: false };
      await this.writePrepayment(trx, record.id, {
        ...previous,
        state: 'done',
        outcome: { amount: fact.amount, refundMode: fact.refundMode, prepaidAt: fact.prepaidAt },
      });
      return { changed: true };
    }, tx);
  }

  /**
   * 선환불 실패(K8 PR6b). 순서 없이 와도 `at` 이 더 늦은 것만 적는다. 일시면 `in_progress`(크론이 다시 낸다),
   * 영구면 `refused`(사람이 다시 시도·계좌 송금). 정산이 먼저였다는 거절은 `superseded`(N7).
   * 이미 끝난(`done`·`superseded`) 선환불의 늦은 실패는 버린다.
   */
  async recordPrepayFailed(fact: ChannelReturnPrepayFailedPayload, tx?: DbTx): Promise<{ changed: boolean }> {
    return this.dbService.run(async (trx) => {
      const record = await this.lockByChannelReturnId(trx, fact.returnId, fact.requestId);
      const previous = record.prepayment;
      if (!previous) {
        throw new ConflictError(`Prepay failure fact for customer return ${record.id}, which has no prepayment`);
      }
      if (previous.state === 'done' || previous.state === 'superseded') return { changed: false };
      if (previous.lastFailure && Date.parse(fact.at) < Date.parse(previous.lastFailure.at)) {
        return { changed: false };
      }
      if (predatesRestart(fact.at, previous)) return { changed: false };
      await this.writePrepayment(trx, record.id, {
        ...previous,
        state: fact.failureCode === PREPAY_SUPERSEDED_CODE ? 'superseded' : fact.retryable ? 'in_progress' : 'refused',
        lastFailure: { code: fact.failureCode, message: fact.message, retryable: fact.retryable, at: fact.at },
      });
      return { changed: true };
    }, tx);
  }

  /**
   * [다시 시도]·[계좌 송금] (N10·N11) — 거절(`refused`)·멈춤(`stalled`)인 정산 또는 선환불 명령을 다시 낸다.
   * 진행 중·끝난 칸은 Conflict, 이미 수동인데 계좌 송금은 Conflict. 칸은 `attempts` 를 1 로, `issues` 를 하나 밀어
   * 새 멱등 키(`…:issue:<issues>`)로 같은 트랜잭션에 명령을 싣는다 — 옛 발행과 키가 겹치지 않는다.
   * 정산은 저장된 CS 입력(`command`)을, 선환불은 처음 요청의 금액·메모를 그대로 싣는다(Medusa 가 그 값으로 같은 요청을 잇는다).
   * «이미 환불한 금액»은 `command` 에 저장해 크론 재발행도 같은 값을 낸다.
   */
  async restart(input: RestartCustomerReturnInput, tx?: DbTx): Promise<CustomerReturnView> {
    return this.dbService.run(async (trx) => {
      const [record] = await trx
        .select()
        .from(wmsTables.customerReturns)
        .where(eq(wmsTables.customerReturns.id, input.customerReturnId))
        .for('update');
      if (!record) throw new NotFoundError(`Customer return not found: ${input.customerReturnId}`);
      if (input.alreadyRefundedAmount !== undefined) {
        if (input.target !== 'settlement' || input.kind !== 'retry') {
          throw new BadRequestError('이미 환불한 금액은 정산 다시 시도에만 적을 수 있습니다');
        }
        if (
          input.alreadyRefundedAmount !== null &&
          (!Number.isInteger(input.alreadyRefundedAmount) || input.alreadyRefundedAmount < 0)
        ) {
          throw new BadRequestError('alreadyRefundedAmount must be a non-negative integer');
        }
      }
      const now = new Date();
      const refundMode =
        input.target === 'settlement'
          ? await this.restartSettlement(trx, record, input, now)
          : await this.restartPrepayment(trx, record, input, now);
      this.logger.log(
        `[ReturnSettlement] customer return ${record.id} ${input.target} restarted (${input.kind}, ${refundMode}) by ${input.actorId}`,
      );
      return this.reader.findById(record.id, trx);
    }, tx);
  }

  /**
   * 마지막 발행이 `CUSTOMER_RETURN_SETTLEMENT_RETRY_MS` 넘은 정산 중 반품에 같은 명령을 다시 낸다(N9). 선환불 칸도
   * 같은 규칙으로 본다(K8 PR6b). 키는 두 칸 모두 `issues + 1`, 상한은 `attempts`(N11).
   * `for update skip locked` 라 두 태스크가 겹쳐 돌아도 한 행을 두 번 내지 않는다. 재발행한 수(정산 + 선환불)를 돌려준다.
   * 영구 거절(`refused`)·멈춤(`stalled`)·닫힘(`done`·`superseded`)은 고르지 않는다.
   */
  async reissueStalled(now: Date, tx?: DbTx): Promise<number> {
    return this.dbService.run(async (trx) => {
      // raw sql 에 Date 를 넘기지 않는다(postgres.js 가 직렬화하지 못한다) — ISO 문자열로
      const cutoff = new Date(now.getTime() - CUSTOMER_RETURN_SETTLEMENT_RETRY_MS).toISOString();
      const settlements = await this.reissueSettlements(trx, now, cutoff);
      const prepayments = await this.reissuePrepayments(trx, now, cutoff);
      return settlements + prepayments;
    }, tx);
  }

  private async reissueSettlements(trx: DbTx, now: Date, cutoff: string): Promise<number> {
    const cr = wmsTables.customerReturns;
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
      // 키는 지금까지 낸 수(issues)를 잇는다 — 다시 시도가 attempts 를 1 로 되돌려도 옛 키와 겹치지 않는다(N11)
      const issue = (settlement.issues ?? settlement.attempts) + 1;
      await enqueueSettleChannelReturn(this.commands, trx, {
        customerReturnId: record.id,
        salesOrderId: record.salesOrderId,
        channelReturnId: record.channelReturnId,
        items: toSettleItems(await loadSettleLines(trx, record.id)),
        refundMode: settlement.refundMode,
        command: settlement.command ?? {},
        issue,
      });
      await this.writeSettlement(trx, record.id, {
        ...settlement,
        attempts: settlement.attempts + 1,
        issues: issue,
        lastIssuedAt: now.toISOString(),
      });
      reissued++;
    }
    return reissued;
  }

  /** 선환불 칸을 정산 칸과 같은 규칙으로 다시 낸다 — 수령 전(`expected`·`arrived`)인 반품만, 처음 요청의 금액·메모 그대로 */
  private async reissuePrepayments(trx: DbTx, now: Date, cutoff: string): Promise<number> {
    const cr = wmsTables.customerReturns;
    const due = await trx
      .select()
      .from(cr)
      .where(
        and(
          inArray(cr.status, [...PREPAYABLE_STATUSES]),
          sql`${cr.prepayment}->>'state' = 'in_progress'`,
          sql`(${cr.prepayment}->>'lastIssuedAt')::timestamptz <= ${cutoff}::timestamptz`,
        ),
      )
      .orderBy(asc(sql`(${cr.prepayment}->>'lastIssuedAt')::timestamptz`))
      .limit(REISSUE_BATCH)
      .for('update', { skipLocked: true });

    let reissued = 0;
    for (const record of due) {
      const prepayment = record.prepayment;
      if (!prepayment) continue;
      if (prepayment.attempts >= CUSTOMER_RETURN_SETTLEMENT_MAX_ISSUES) {
        await this.writePrepayment(trx, record.id, { ...prepayment, state: 'stalled' });
        this.logger.error(
          `[ReturnPrepay] customer return ${record.id} (channel ${record.channelReturnId}) stalled after ` +
            `${prepayment.attempts} issues; last failure: ${prepayment.lastFailure?.code ?? 'none'}`,
        );
        continue;
      }
      const issue = prepayment.issues + 1;
      await enqueuePrepayChannelReturn(this.commands, trx, {
        customerReturnId: record.id,
        salesOrderId: record.salesOrderId,
        channelReturnId: record.channelReturnId,
        amount: prepayment.requestedAmount,
        refundMode: prepayment.refundMode,
        memo: prepayment.memo,
        issue,
      });
      await this.writePrepayment(trx, record.id, {
        ...prepayment,
        attempts: prepayment.attempts + 1,
        issues: issue,
        lastIssuedAt: now.toISOString(),
      });
      reissued++;
    }
    return reissued;
  }

  /** 정산 다시 시도·계좌 송금 — 정산 중인 반품의 거절·멈춤 칸만. 쓴 refundMode 를 돌려준다 */
  private async restartSettlement(
    trx: DbTx,
    record: CustomerReturn,
    input: RestartCustomerReturnInput,
    now: Date,
  ): Promise<'auto' | 'manual'> {
    const settlement = record.settlement;
    if (!settlement || (record.status !== 'inspected' && record.status !== 'refund_pending')) {
      throw new ConflictError(`Customer return ${record.id} is not settling: status is ${record.status}`);
    }
    assertRestartable('정산', settlement.state);
    if (input.kind === 'manual' && settlement.refundMode === 'manual') {
      throw new ConflictError('이미 계좌 송금으로 환불하고 있습니다');
    }
    let command = settlement.command ?? {};
    if (input.alreadyRefundedAmount !== undefined) {
      if (!settlement.lastFailure?.code.startsWith(EXTERNAL_REFUND_REJECTED_PREFIX)) {
        throw new BadRequestError('이미 환불한 금액은 채널이 외부 환불로 거절한 정산에만 적거나 지울 수 있습니다');
      }
      command = { ...command };
      // null 은 지우기 — 칸을 없애 명령에도 싣지 않는다
      if (input.alreadyRefundedAmount === null) delete command.alreadyRefundedAmount;
      else command.alreadyRefundedAmount = input.alreadyRefundedAmount;
    }
    const refundMode = input.kind === 'manual' ? 'manual' : settlement.refundMode;
    const issue = (settlement.issues ?? settlement.attempts) + 1;
    await this.writeSettlement(trx, record.id, {
      ...settlement,
      state: 'in_progress',
      refundMode,
      attempts: 1,
      issues: issue,
      lastIssuedAt: now.toISOString(),
      command,
      restartedAt: now.toISOString(),
      restartedBy: input.actorId,
    });
    await enqueueSettleChannelReturn(this.commands, trx, {
      customerReturnId: record.id,
      salesOrderId: record.salesOrderId,
      channelReturnId: record.channelReturnId,
      items: toSettleItems(await loadSettleLines(trx, record.id)),
      refundMode,
      command,
      issue,
    });
    return refundMode;
  }

  /** 선환불 다시 시도·계좌 송금 — 수령 전 반품의 거절·멈춤 칸만. 바뀌는 것은 refundMode 뿐이다 */
  private async restartPrepayment(
    trx: DbTx,
    record: CustomerReturn,
    input: RestartCustomerReturnInput,
    now: Date,
  ): Promise<'auto' | 'manual'> {
    const prepayment = record.prepayment;
    if (!prepayment) throw new ConflictError(`Customer return ${record.id} has no prepayment`);
    if (record.status !== 'expected' && record.status !== 'arrived') {
      throw new ConflictError(`Customer return ${record.id} cannot be prepaid: status is ${record.status}`);
    }
    if (record.csResolution?.missing) {
      throw new ConflictError('미도착으로 닫은 반품은 먼저 환불할 수 없습니다');
    }
    assertRestartable('선환불', prepayment.state);
    if (input.kind === 'manual' && prepayment.refundMode === 'manual') {
      throw new ConflictError('이미 계좌 송금으로 환불하고 있습니다');
    }
    const refundMode = input.kind === 'manual' ? 'manual' : prepayment.refundMode;
    const issue = prepayment.issues + 1;
    await this.writePrepayment(trx, record.id, {
      ...prepayment,
      state: 'in_progress',
      refundMode,
      attempts: 1,
      issues: issue,
      lastIssuedAt: now.toISOString(),
      restartedAt: now.toISOString(),
      restartedBy: input.actorId,
    });
    await enqueuePrepayChannelReturn(this.commands, trx, {
      customerReturnId: record.id,
      salesOrderId: record.salesOrderId,
      channelReturnId: record.channelReturnId,
      amount: prepayment.requestedAmount,
      refundMode,
      memo: prepayment.memo,
      issue,
    });
    return refundMode;
  }

  /**
   * 채널 반품 id 로 기록을 잠그고, 사실의 requestId(= 정산·선환불 명령이 실은 customerReturnId)가 그 기록인지 본다.
   * 다르면 다른 기록의 정산 결과다 — 아무것도 쓰기 전에 ConflictError(DLQ) 로 사람에게 넘긴다.
   */
  private async lockByChannelReturnId(trx: DbTx, channelReturnId: string, requestId: string): Promise<CustomerReturn> {
    const [record] = await trx
      .select()
      .from(wmsTables.customerReturns)
      .where(eq(wmsTables.customerReturns.channelReturnId, channelReturnId))
      .for('update');
    if (!record) throw new NotFoundError(`Customer return not found for channel return ${channelReturnId}`);
    if (record.id !== requestId) {
      throw new ConflictError(
        `Return fact for channel return ${channelReturnId} names request ${requestId}, but the record is ${record.id}`,
      );
    }
    return record;
  }

  /** 상태를 바꾸지 않는 선환불 칸 쓰기 — 상태는 `transitionCustomerReturn` 만 쓴다 */
  private async writePrepayment(trx: DbTx, id: string, prepayment: CustomerReturnPrepayment): Promise<void> {
    await trx
      .update(wmsTables.customerReturns)
      .set({ prepayment, updatedAt: new Date() })
      .where(eq(wmsTables.customerReturns.id, id));
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
}
