import { Injectable, Logger } from '@nestjs/common';
import { asc, eq, gt, min, sql } from 'drizzle-orm';
import { CronOnce } from '@app/cron-once';
import { DbService, describeFailedRun } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { InjectPublisher, type PublisherFor } from '@app/events';
import { CORE_ORDER_STREAM } from '@packages/event-contracts/streams';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { readLineReservationStates } from './line-reservation-state.reader';

/** 한 번에 고르는 표시된 주문 수. */
export const LINE_STATE_PUBLISH_BATCH = 200;
/** 한 틱이 배치를 이어 도는 시간 한도. 1분 주기 안에서 끝나게 둔다. */
export const LINE_STATE_PUBLISH_BUDGET_MS = 40_000;

export type LineStatePublishOutcome =
  /** 버전을 올리고 스냅샷을 실었다. */
  | 'published'
  /** 다른 트랜잭션이 판매주문 행을 잡고 있다 — 기다리지 않고 다음 틱에 다시 본다. */
  | 'locked'
  /** 지울 표시가 없었다(다른 폴러가 먼저 냈다). */
  | 'clean'
  /** 판매주문이 없다 — 표시만 지웠다. */
  | 'gone';

/**
 * 표시된 주문을 가장 오래된 표시 순으로 고른다. `afterMarkId` 는 한 틱 안에서 앞 배치 다음부터 보는 커서다 —
 * 잠겨서 건너뛴 주문이 같은 틱의 다음 배치 앞자리를 다시 차지하지 않는다.
 */
export async function pickMarkedOrders(
  trx: DbTx,
  args: { afterMarkId: number; limit: number },
): Promise<Array<{ salesOrderId: string; firstMarkId: number }>> {
  const marks = wmsTables.salesOrderLineStateMarks;
  const firstMarkId = min(marks.id);
  const rows = await trx
    .select({ salesOrderId: marks.salesOrderId, firstMarkId })
    .from(marks)
    .groupBy(marks.salesOrderId)
    .having(gt(firstMarkId, args.afterMarkId))
    .orderBy(asc(firstMarkId))
    .limit(args.limit);
  return rows.flatMap((row) =>
    row.firstMarkId === null ? [] : [{ salesOrderId: row.salesOrderId, firstMarkId: row.firstMarkId }],
  );
}

/**
 * 주문 하나의 스냅샷을 낸다 (#1247). 호출자 트랜잭션 하나에서:
 * 1. 판매주문 행 `FOR NO KEY UPDATE SKIP LOCKED` — 잡혀 있으면 기다리지 않는다. 키를 바꾸지 않으므로 FK 검사(KEY SHARE)는 막지 않는다. 폴러는 판매주문 행만 잡으므로
 *    다른 쓰기와 잠금 순서가 뒤집힐 일이 없다.
 * 2. 그 주문의 표시를 `DELETE … RETURNING` 으로 지운다 — 이 문이 본(커밋된) 표시만 지워진다.
 *    늦게 커밋되는 표시(번호가 더 작아도)는 남아서 다음 틱이 새 버전으로 다시 낸다.
 * 3. `line_state_version + 1` (이 열을 쓰는 곳은 여기뿐이다) → `readLineReservationStates`(올린 버전을 같은 트랜잭션에서 읽는다)
 *    → `SalesOrderLineReservationState` enqueue, 멱등키 `so-line-state:<id>:<version>`.
 * 표시를 지운 뒤에 수량을 읽으므로, 지운 표시가 가리키는 변화는 전부 이 스냅샷에 들어 있다.
 * 채널을 거르지 않는다 — core 는 어느 채널이 투영하는지 모른다(소비자가 거른다).
 */
export async function publishLineStateOf(
  trx: DbTx,
  publisher: PublisherFor<typeof CORE_ORDER_STREAM>,
  salesOrderId: string,
  asOf: Date,
): Promise<LineStatePublishOutcome> {
  const so = wmsTables.salesOrders;
  const marks = wmsTables.salesOrderLineStateMarks;
  const [locked] = await trx
    .select({ id: so.id })
    .from(so)
    .where(eq(so.id, salesOrderId))
    .for('no key update', { skipLocked: true });
  if (!locked) {
    const [exists] = await trx.select({ id: so.id }).from(so).where(eq(so.id, salesOrderId));
    if (exists) return 'locked';
    await trx.delete(marks).where(eq(marks.salesOrderId, salesOrderId));
    return 'gone';
  }

  const consumed = await trx.delete(marks).where(eq(marks.salesOrderId, salesOrderId)).returning({ id: marks.id });
  if (consumed.length === 0) return 'clean';

  await trx
    .update(so)
    .set({ lineStateVersion: sql`${so.lineStateVersion} + 1` })
    .where(eq(so.id, salesOrderId));
  const [state] = await readLineReservationStates(trx, [salesOrderId], asOf);
  await publisher.enqueue(
    {
      idempotencyKey: `so-line-state:${state.salesOrderId}:${state.version}`,
      eventType: 'SalesOrderLineReservationState',
      aggregateId: state.salesOrderId,
      partitionKey: state.salesOrderId,
      payload: state,
    },
    trx,
  );
  return 'published';
}

/**
 * 판매주문 줄 상태 스냅샷 1분 폴러 (#1247, 스펙 §5-1). 상태를 바꾸는 트랜잭션은 표시만 하고, 여기서 모아 낸다 —
 * 한 트랜잭션의 여러 변화가 한 이벤트로 모이고, 대가는 최대 1분 지연이다.
 * 테넌트 DB 마다 그 맥락에서 돈다. 주문마다 짧은 트랜잭션 하나라, 한 주문의 실패는 그 주문에 갇힌다(표시가 남아 다음 틱이 다시 낸다).
 */
@Injectable()
export class LineStatePublisher {
  private readonly logger = new Logger(LineStatePublisher.name);
  private running = false;

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    @InjectPublisher(CORE_ORDER_STREAM)
    private readonly coreOrders: PublisherFor<typeof CORE_ORDER_STREAM>,
  ) {}

  @CronOnce('* * * * *', { name: 'sales-order-line-state-publish' })
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const deadline = Date.now() + LINE_STATE_PUBLISH_BUDGET_MS;
      const runs = await this.dbService.forEachDatabase(() => this.drainCurrentDatabase(deadline));
      for (const run of runs) {
        if (!run.ok) {
          this.logger.error(
            `판매주문 줄 상태 발행 실패: ${describeFailedRun(run)}`,
            run.error instanceof Error ? run.error.stack : undefined,
          );
        } else if (run.value > 0) {
          this.logger.log(`판매주문 줄 상태 ${run.value}건 적재${run.key === undefined ? '' : ` [db=${run.key}]`}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * 지금 DB 에서 배치를 이어 돈다 — 고른 주문이 한도보다 적거나 `deadline` 이 지나면 멈춘다.
   * 한도가 지나 있어도 한 배치는 돈다: DB 가 여럿일 때 뒤 DB 가 굶지 않는다. 남은 건 다음 틱이 낸다.
   * 낸 주문 수를 돌려준다.
   */
  async drainCurrentDatabase(deadline: number): Promise<number> {
    let published = 0;
    let afterMarkId = 0;
    for (;;) {
      const batch = await this.pickBatch(afterMarkId);
      for (const { salesOrderId } of batch) {
        try {
          if ((await this.publishOrder(salesOrderId)) === 'published') published += 1;
        } catch (error) {
          this.logger.error(
            `판매주문 줄 상태 발행 실패 (salesOrderId=${salesOrderId}): ${error instanceof Error ? error.message : String(error)}`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
      if (batch.length < LINE_STATE_PUBLISH_BATCH || Date.now() >= deadline) return published;
      afterMarkId = batch[batch.length - 1].firstMarkId;
    }
  }

  async pickBatch(afterMarkId: number): Promise<Array<{ salesOrderId: string; firstMarkId: number }>> {
    return this.dbService.run((trx) => pickMarkedOrders(trx, { afterMarkId, limit: LINE_STATE_PUBLISH_BATCH }));
  }

  async publishOrder(salesOrderId: string): Promise<LineStatePublishOutcome> {
    return this.dbService.run((trx) => publishLineStateOf(trx, this.coreOrders, salesOrderId, new Date()));
  }
}
