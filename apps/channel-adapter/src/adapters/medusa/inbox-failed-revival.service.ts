import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { inboxEvents } from '../../schema';
import { MedusaClient } from './medusa.client';
import type { ChannelAdapterSchema } from '../../types';

/** 이 접두사로 시작하는 실패만 되살린다. 다른 실패는 상품이 생겨도 해결되지 않는다. */
const PRODUCT_NOT_FOUND_PREFIX = 'Medusa product not found';

/** Medusa 는 1 vCPU 라 확인 호출을 몰아치지 않는다. */
const LOOKUP_INTERVAL_MS = 200;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 상품 생성보다 재고 이벤트가 먼저 처리돼 `Medusa product not found` 로 죽은 inbox 행을
 * 매일 새벽 4시에 되살린다. 대량 상품등록과 재고 동기화가 겹친 날 생긴다.
 *
 * - `recalc-sellable` 재발행으로는 못 고친다. Core 프로젝션이 이미 최신이라 전부 스킵된다.
 * - 깨우기 전에 Medusa 에 상품이 생겼는지 확인한다. 아니면 attempts 만 또 태운다.
 * - variant 당 최신 실패 하나만 깨운다 (아래 `revivable` 참고).
 */
@Injectable()
export class InboxFailedRevivalService {
  private readonly logger = new Logger(InboxFailedRevivalService.name);

  constructor(
    private readonly dbService: DbService<ChannelAdapterSchema>,
    private readonly medusaClient: MedusaClient,
  ) {}

  @Cron('0 4 * * *', { timeZone: 'Asia/Seoul' })
  async reviveProductNotFoundFailures(): Promise<void> {
    // SELECT 와 UPDATE 가 같이 쓴다 — 그 사이 상태가 바뀐 행을 id 만으로 덮어쓰지 않기 위해.
    //
    // 같은 variant 에 더 최신 이벤트가 있으면 건너뛴다. sellableQuantity 는
    // 절대값이라 뒤처진 이벤트를 깨우면 최신 수량을 과거 값으로 덮는다. 워커의 supersede
    // 가드는 pending/processing 만 봐서 이미 published 된 최신 이벤트를 못 막는다.
    // 시각 비교를 DB 안에서 하는 이유는 inbox-worker.service.ts 의 같은 주석 참고.
    const revivable = and(
      eq(inboxEvents.status, 'failed'),
      eq(inboxEvents.eventType, 'ProductSellableQuantityChanged'),
      like(inboxEvents.errorMessage, `${PRODUCT_NOT_FOUND_PREFIX}%`),
      sql`not exists (
        select 1 from ${inboxEvents} newer
        where newer.aggregate_id = ${inboxEvents.aggregateId}
          and newer.event_type = ${inboxEvents.eventType}
          and newer.id <> ${inboxEvents.id}
          and coalesce(newer.event_occurred_at, newer.created_at)
              > coalesce(${inboxEvents.eventOccurredAt}, ${inboxEvents.createdAt})
      )`,
    );

    const failures = await this.dbService.db
      .select({ id: inboxEvents.id, payload: inboxEvents.payload })
      .from(inboxEvents)
      .where(revivable);

    if (failures.length === 0) {
      this.logger.log('되살릴 product-not-found 실패 없음');
      return;
    }

    const idsByMaster = new Map<string, string[]>();
    let missingMasterId = 0;
    for (const row of failures) {
      const masterId = (row.payload as { masterId?: string } | null)?.masterId;
      if (!masterId) {
        missingMasterId += 1;
        continue;
      }
      const ids = idsByMaster.get(masterId);
      if (ids) ids.push(row.id);
      else idsByMaster.set(masterId, [row.id]);
    }

    this.logger.log(
      `product-not-found 실패 ${failures.length}건 / 상품 ${idsByMaster.size}개 확인 시작` +
        (missingMasterId > 0 ? ` (masterId 없는 행 ${missingMasterId}건 제외)` : ''),
    );

    const reviveIds: string[] = [];
    let stillMissing = 0;
    let lookupFailed = 0;
    for (const [masterId, ids] of idsByMaster) {
      try {
        const product = await this.medusaClient.findProductByHandle(masterId);
        if (product) reviveIds.push(...ids);
        else stillMissing += 1;
      } catch (error) {
        // failed 로 남으니 내일 다시 본다.
        lookupFailed += 1;
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`masterId=${masterId} 존재 확인 실패, 이번 회차 건너뜀: ${reason}`);
      }
      await sleep(LOOKUP_INTERVAL_MS);
    }

    if (reviveIds.length > 0) {
      await this.dbService.db
        .update(inboxEvents)
        .set({
          status: 'pending',
          attempts: 0,
          nextAttemptAt: new Date(),
          errorMessage: null,
          failedAt: null,
        })
        .where(and(revivable, inArray(inboxEvents.id, reviveIds)));
    }

    this.logger.log(
      `되살리기 완료: ${reviveIds.length}건 pending 전환 | ` +
        `아직 상품 없음 ${stillMissing}개 | 조회 실패 ${lookupFailed}개`,
    );
  }
}
