import { Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { DbService } from '@app/db';
import { channelAdapterSchema, orderCollectionFailures } from '../../schema';
import { NewOrderCollectionFailure, OrderCollectionFailure, OrderCollectionFailureStatus } from '../../types';
import {
  ORDER_COLLECTION_PROCESSING_FAILED,
  OrderCollectionFailureItem,
  OrderCollectionFailureReason,
  OrderProcessingFailureItem,
} from './channel-order-provider.interface';

/** 최초 실패 1회 + 자동 재시도 3회. 이 횟수에 닿은 열린 처리 실패 행이 «사람 몫»이다 (#1016 1번 행 스펙 §4.5). */
export const PROCESSING_FAILURE_MAX_ATTEMPTS = 4;
/** 채널당 한 주기에 자동 재시도할 행 수 상한 — 네이버 API 호출량과 주기 길이의 상한이다 (스펙 §6.2). */
export const PROCESSING_FAILURE_RETRY_BATCH = 20;

type DbTx = Parameters<Parameters<DbService<typeof channelAdapterSchema>['db']['transaction']>[0]>[0];

@Injectable()
export class OrderCollectionFailureService {
  private readonly logger = new Logger(OrderCollectionFailureService.name);

  constructor(private readonly db: DbService<typeof channelAdapterSchema>) {}

  async recordFailure(
    channel: string,
    failure: OrderCollectionFailureItem,
    tx?: DbTx,
  ): Promise<OrderCollectionFailure> {
    const now = new Date();
    const values: NewOrderCollectionFailure = {
      channel,
      externalOrderId: failure.externalOrderId,
      reason: failure.reason,
      affectedLineIds: failure.affectedLineIds,
      affectedLines: failure.affectedLines ?? null,
      rawOrder: failure.rawOrder,
      sourceUpdatedAt: parseTimestamp(failure.sourceUpdatedAt),
      status: 'quarantined',
      replayedAt: null,
      replayedWmsOrderId: null,
      errorMessage: null,
      updatedAt: now,
    };

    const exec = (trx: DbTx | DbService<typeof channelAdapterSchema>['db']) =>
      trx
        .insert(orderCollectionFailures)
        .values(values)
        .onConflictDoUpdate({
          target: [
            orderCollectionFailures.channel,
            orderCollectionFailures.externalOrderId,
            orderCollectionFailures.reason,
          ],
          set: {
            affectedLineIds: values.affectedLineIds,
            affectedLines: values.affectedLines,
            rawOrder: values.rawOrder,
            sourceUpdatedAt: values.sourceUpdatedAt,
            status: 'quarantined',
            replayedAt: null,
            replayedWmsOrderId: null,
            errorMessage: null,
            updatedAt: now,
          },
        })
        .returning();

    const [record] = await exec(tx ?? this.db.db);
    this.logger.warn(`Quarantined order collection failure: ${channel}/${failure.externalOrderId}`, {
      reason: failure.reason,
      affectedLineIds: failure.affectedLineIds,
    });
    return record;
  }

  /**
   * 주문 하나의 처리 실패를 기록한다 (#1016 1번 행 스펙 §4.4).
   *
   * `recordFailure` 와 달리 **횟수를 누적한다** — 초기화하면 계속 바뀌는 주문이 영영 소진되지 않는다.
   * 종결된 행이 다시 실패하면 새 사건이라 1 부터 센다. 이어 세면 한 번 풀린 주문이 다음 실패에서
   * 자동 재시도 없이 곧바로 사람 몫이 된다.
   */
  async recordProcessingFailure(
    channel: string,
    failure: OrderProcessingFailureItem,
    tx?: DbTx,
  ): Promise<{ record: OrderCollectionFailure; exhaustedNow: boolean }> {
    const now = new Date();
    const values: NewOrderCollectionFailure = {
      channel,
      externalOrderId: failure.externalOrderId,
      reason: ORDER_COLLECTION_PROCESSING_FAILED,
      affectedLineIds: [],
      affectedLines: null,
      rawOrder: failure.input,
      sourceUpdatedAt: parseTimestamp(failure.sourceUpdatedAt),
      status: 'quarantined',
      replayedAt: null,
      replayedWmsOrderId: null,
      errorMessage: null,
      attemptCount: 1,
      failedStage: failure.stage,
      lastError: failure.error,
      updatedAt: now,
    };

    const exec = (trx: DbTx | DbService<typeof channelAdapterSchema>['db']) =>
      trx
        .insert(orderCollectionFailures)
        .values(values)
        .onConflictDoUpdate({
          target: [
            orderCollectionFailures.channel,
            orderCollectionFailures.externalOrderId,
            orderCollectionFailures.reason,
          ],
          set: {
            rawOrder: values.rawOrder,
            sourceUpdatedAt: values.sourceUpdatedAt,
            attemptCount: sql`CASE WHEN ${orderCollectionFailures.status} = 'quarantined' THEN ${orderCollectionFailures.attemptCount} + 1 ELSE 1 END`,
            failedStage: values.failedStage,
            lastError: values.lastError,
            status: 'quarantined',
            replayedAt: null,
            replayedWmsOrderId: null,
            errorMessage: null,
            updatedAt: now,
          },
        })
        .returning();

    const [record] = await exec(tx ?? this.db.db);
    // 정확히 상한에 닿은 한 번만 true — 소진 로그를 매 주기 반복하지 않기 위함이다(스펙 §6.4).
    return { record, exhaustedNow: record.attemptCount === PROCESSING_FAILURE_MAX_ATTEMPTS };
  }

  /** 이번 폴링 항목들의 주문 중 열린 처리 실패 행. 그 주문이 이번 주기에 성공하면 닫는 근거다 (스펙 §5.4). */
  async findOpenProcessingFailures(
    channel: string,
    externalOrderIds: string[],
  ): Promise<Map<string, OrderCollectionFailure>> {
    if (externalOrderIds.length === 0) {
      return new Map();
    }
    const rows = await this.db.db
      .select()
      .from(orderCollectionFailures)
      .where(
        and(
          eq(orderCollectionFailures.channel, channel),
          eq(orderCollectionFailures.reason, ORDER_COLLECTION_PROCESSING_FAILED),
          eq(orderCollectionFailures.status, 'quarantined'),
          inArray(orderCollectionFailures.externalOrderId, externalOrderIds),
        ),
      );
    return new Map(rows.map((row) => [row.externalOrderId, row]));
  }

  /**
   * 자동 재시도 대상 (스펙 §6.2). `before` 는 이번 주기 시작 시각이다 — 방금 실패한 행을 몇 초 뒤에 또 시도해
   * 한 주기에 횟수를 다 써 버리지 않게 막고, 그래서 «주기당 1회»가 성립한다.
   */
  async findRetryableProcessingFailures(
    channel: string,
    before: Date,
    limit: number = PROCESSING_FAILURE_RETRY_BATCH,
  ): Promise<OrderCollectionFailure[]> {
    return await this.db.db
      .select()
      .from(orderCollectionFailures)
      .where(
        and(
          eq(orderCollectionFailures.channel, channel),
          eq(orderCollectionFailures.reason, ORDER_COLLECTION_PROCESSING_FAILED),
          eq(orderCollectionFailures.status, 'quarantined'),
          lt(orderCollectionFailures.attemptCount, PROCESSING_FAILURE_MAX_ATTEMPTS),
          lt(orderCollectionFailures.updatedAt, before),
        ),
      )
      .orderBy(asc(orderCollectionFailures.updatedAt))
      .limit(limit);
  }

  /** 사유와 무관하게 그 주문의 열린 행 전부. 종결된 주문은 어느 사유로도 수집할 수 없다 (스펙 §5.5). */
  async findAllOpenByExternalOrderId(channel: string, externalOrderId: string): Promise<OrderCollectionFailure[]> {
    return await this.db.db
      .select()
      .from(orderCollectionFailures)
      .where(
        and(
          eq(orderCollectionFailures.channel, channel),
          eq(orderCollectionFailures.externalOrderId, externalOrderId),
          eq(orderCollectionFailures.status, 'quarantined'),
        ),
      );
  }

  async findById(id: string): Promise<OrderCollectionFailure | null> {
    const rows = await this.db.db
      .select()
      .from(orderCollectionFailures)
      .where(eq(orderCollectionFailures.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(options: {
    channel?: string;
    reason?: OrderCollectionFailureReason;
    status?: OrderCollectionFailureStatus;
    limit?: number;
    offset?: number;
  }): Promise<OrderCollectionFailure[]> {
    const conditions: SQL[] = [];
    if (options.channel) {
      conditions.push(eq(orderCollectionFailures.channel, options.channel));
    }
    if (options.reason) {
      conditions.push(eq(orderCollectionFailures.reason, options.reason));
    }
    if (options.status) {
      conditions.push(eq(orderCollectionFailures.status, options.status));
    }

    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);

    return await this.db.db
      .select()
      .from(orderCollectionFailures)
      .where(conditions.length > 0 ? and(...conditions) : sql`true`)
      .orderBy(desc(orderCollectionFailures.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /**
   * 격리 건수 요약 — 정체 보드 0단계(스펙 2026-10-06 §7.3). 목록은 상한 200건이라 건수로 쓸 수 없다.
   * created_at 은 tz 없는 timestamp 이고 DB 세션이 UTC 로 쓴다는 전제로 그대로 Z 를 붙인다.
   */
  async summarizeQuarantined(
    options: { channel?: string } = {},
  ): Promise<{ quarantined: number; oldestCreatedAt: string | null }> {
    const conditions: SQL[] = [
      eq(orderCollectionFailures.status, 'quarantined'),
      // 자동 재시도가 남은 처리 실패는 아직 사람 몫이 아니다 — 정체 보드 0단계와 배지가 같은 숫자를 본다 (스펙 §7.1).
      sql`(${orderCollectionFailures.reason} <> ${ORDER_COLLECTION_PROCESSING_FAILED} OR ${orderCollectionFailures.attemptCount} >= ${PROCESSING_FAILURE_MAX_ATTEMPTS})`,
    ];
    if (options.channel) conditions.push(eq(orderCollectionFailures.channel, options.channel));
    const [row] = await this.db.db
      .select({
        quarantined: sql<number>`count(*)::int`,
        oldestCreatedAt: sql<
          string | null
        >`to_char(min(${orderCollectionFailures.createdAt}), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      })
      .from(orderCollectionFailures)
      .where(and(...conditions));
    return { quarantined: row?.quarantined ?? 0, oldestCreatedAt: row?.oldestCreatedAt ?? null };
  }

  async markReplayed(id: string, wmsOrderId?: string, note?: string): Promise<void> {
    await this.db.db
      .update(orderCollectionFailures)
      .set({
        status: 'replayed',
        replayedAt: new Date(),
        replayedWmsOrderId: wmsOrderId ?? null,
        // 매핑 없이 닫히는 경우(식별 실패 격리로 넘어감 등) 왜 닫혔는지가 여기 남는다.
        ...(note ? { errorMessage: note } : {}),
        updatedAt: new Date(),
      })
      .where(eq(orderCollectionFailures.id, id));
  }

  /**
   * 채널 + externalOrderId 로 아직 열려 있는(quarantined) 격리 레코드를 찾는다.
   * 이전 poll 에서 격리된 주문이 이후 terminal lifecycle 로 바뀌었는지 판단할 때 사용.
   * `reason` 을 주면 그 사유의 행만 찾는다(수집된 주문의 «변경» 격리를 식별 실패 격리와 구별해야 할 때).
   */
  async findOpenByExternalOrderId(
    channel: string,
    externalOrderId: string,
    reason?: OrderCollectionFailureReason,
  ): Promise<OrderCollectionFailure | null> {
    const rows = await this.db.db
      .select()
      .from(orderCollectionFailures)
      .where(
        and(
          eq(orderCollectionFailures.channel, channel),
          eq(orderCollectionFailures.externalOrderId, externalOrderId),
          eq(orderCollectionFailures.status, 'quarantined'),
          reason ? eq(orderCollectionFailures.reason, reason) : undefined,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * 격리된 주문이 수집되기 전에 terminal lifecycle(취소/환불 → 수집 불가)에 도달했을 때 호출.
   * replay 로는 결코 수집될 수 없으므로 격리를 닫아 고아 상태로 남지 않게 한다.
   */
  async closeAsTerminalLifecycle(id: string, reason: string): Promise<void> {
    await this.close(id, 'closed_lifecycle', reason);
  }

  /**
   * 그 주문이 이미 Core 판매주문을 갖고 있을 때 호출 (#647).
   *
   * 조치 대상이 아니다 — 만들 주문이 이미 있으므로 replay 로 할 일이 없고, replay 는 같은 식별
   * 실패에 다시 걸려 `still_quarantined` 만 반환한다. 열어두면 운영자가 조치 불가능한 항목을
   * 붙들게 되므로 닫는다.
   *
   * `wmsOrderId` 는 닫은 근거다. 없으면 나중에 "정말 수집돼 있었나" 를 확인하려고 행마다
   * `wms_order_mappings` 조인을 다시 돌려야 한다.
   */
  async closeAsAlreadyCollected(id: string, reason: string, wmsOrderId?: string): Promise<void> {
    await this.close(id, 'closed_already_collected', reason, wmsOrderId);
  }

  /** 종결 상태 전이의 공통 경로. 상태값만 다르고 나머지는 같다. */
  private async close(
    id: string,
    status: Extract<OrderCollectionFailureStatus, `closed_${string}`>,
    reason: string,
    wmsOrderId?: string,
  ): Promise<void> {
    await this.db.db
      .update(orderCollectionFailures)
      .set({
        status,
        errorMessage: reason,
        ...(wmsOrderId ? { replayedWmsOrderId: wmsOrderId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(orderCollectionFailures.id, id));
  }
}

function parseTimestamp(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
