import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, gt, lt } from 'drizzle-orm';
import { CronOnce } from '@app/cron-once';
import { DbService, describeFailedRun } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { InjectPublisher, type PublisherFor } from '@app/events';
import { CORE_ORDER_STREAM } from '@packages/event-contracts/streams';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { readLineReservationStates } from './line-reservation-state.reader';

/** 한 트랜잭션이 잡는 더러운 주문 수. */
export const LINE_STATE_PUBLISH_BATCH = 200;
/** 한 틱이 배치를 이어 도는 시간 한도. 1분 주기 안에서 끝나게 둔다. */
export const LINE_STATE_PUBLISH_BUDGET_MS = 40_000;

/**
 * 더러운 주문(`line_state_version > line_state_published_version`)을 최대 `limit` 개 잡아 스냅샷을 outbox 에 싣는다 (#1247).
 *
 * 한 트랜잭션: `FOR UPDATE SKIP LOCKED` 로 잡고 → `readLineReservationStates` → 주문마다 enqueue →
 * `published_version = <읽은 version>` (`published < 읽은 version` 일 때만). 잡은 행은 이 트랜잭션이 끝날 때까지
 * 표시(`markLineStateDirty`)가 기다리므로, 끝난 뒤 오른 버전은 published 보다 커서 다음 배치가 다시 낸다.
 * published 를 «현재» 버전이 아니라 «읽은» 버전으로만 올리는 것이 그 재발행의 근거다 — 리더가 버전을 수량보다 먼저 읽는다.
 *
 * 멱등키 `so-line-state:<id>:<version>` 라 같은 버전을 다시 실어도 outbox 행은 하나다.
 * 채널을 거르지 않는다 — core 는 어느 채널이 투영하는지 모른다(소비자가 거른다).
 * 잡은 주문 수를 돌려준다(`limit` 보다 작으면 더 없다).
 */
export async function publishDirtyLineStates(
  trx: DbTx,
  publisher: PublisherFor<typeof CORE_ORDER_STREAM>,
  args: { limit: number; asOf: Date },
): Promise<number> {
  const so = wmsTables.salesOrders;
  const dirty = await trx
    .select({ id: so.id })
    .from(so)
    // 부분 인덱스 `idx_sales_orders_line_state_dirty` 의 술어 그대로
    .where(gt(so.lineStateVersion, so.lineStatePublishedVersion))
    .orderBy(asc(so.id))
    .limit(args.limit)
    .for('update', { skipLocked: true });
  if (dirty.length === 0) return 0;

  const states = await readLineReservationStates(
    trx,
    dirty.map((row) => row.id),
    args.asOf,
  );
  for (const state of states) {
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
    await trx
      .update(so)
      .set({ lineStatePublishedVersion: state.version })
      .where(and(eq(so.id, state.salesOrderId), lt(so.lineStatePublishedVersion, state.version)));
  }
  return dirty.length;
}

/**
 * 판매주문 줄 상태 스냅샷 1분 폴러 (#1247, 스펙 §5-1). 상태를 바꾸는 트랜잭션은 표시만 하고, 여기서 모아 낸다 —
 * 한 트랜잭션의 여러 변화가 한 이벤트로 모이고, 대가는 최대 1분 지연이다.
 * 테넌트 DB 마다 그 맥락에서 돈다. 한 DB 의 실패는 그 DB 에 갇힌다(표시가 남아 다음 틱이 다시 낸다).
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
   * 지금 DB 에서 배치를 이어 돈다 — 배치가 한도보다 작거나 `deadline` 이 지나면 멈춘다.
   * 한도가 지나 있어도 한 배치는 돈다: DB 가 여럿일 때 뒤 DB 가 굶지 않는다. 남은 건 다음 틱이 낸다.
   */
  async drainCurrentDatabase(deadline: number): Promise<number> {
    let total = 0;
    for (;;) {
      const picked = await this.publishBatch();
      total += picked;
      if (picked < LINE_STATE_PUBLISH_BATCH || Date.now() >= deadline) return total;
    }
  }

  async publishBatch(): Promise<number> {
    return this.dbService.run((trx) =>
      publishDirtyLineStates(trx, this.coreOrders, { limit: LINE_STATE_PUBLISH_BATCH, asOf: new Date() }),
    );
  }
}
