import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { and, eq, inArray, like } from 'drizzle-orm';
import { inboxEvents } from '../../schema';
import { MedusaClient } from './medusa.client';
import type { ChannelAdapterSchema } from '../../types';

/**
 * `handleProductSellableQuantityChanged` 가 상품을 못 찾았을 때 내는 메시지의 접두사.
 * 이 접두사로 시작하는 실패만 되살린다 — 다른 실패(권한, 타임아웃, 재고 반영 자체의 오류)는
 * 상품이 생겼다고 해결되지 않으므로 건드리지 않는다.
 */
const PRODUCT_NOT_FOUND_PREFIX = 'Medusa product not found';

/** Medusa 는 1 vCPU 라 확인 호출을 몰아치지 않는다 (MembershipDailySyncService 와 같은 간격). */
const LOOKUP_INTERVAL_MS = 200;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * InboxFailedRevivalService
 *
 * 재고 이벤트가 상품 생성보다 먼저 처리돼 `Medusa product not found` 로 죽은 inbox 행을
 * 매일 새벽 되살린다. 대량 상품등록과 재고 동기화가 겹친 날 생긴다
 * (docs/runbooks/selmate-stock-pipeline.md 「대량 상품등록과 겹치면 재고가 뒤로 밀린다」).
 *
 * **`recalc-sellable` 로는 못 고친다.** Core 프로젝션은 이미 최신값이라 재발행이 전부
 * "변동없음" 으로 스킵된다. inbox 행을 직접 깨우는 게 유일한 경로다.
 *
 * 되살리기 전에 **Medusa 에 상품이 실제로 생겼는지 확인**한다. 확인 없이 깨우면 아직 없는
 * 상품은 attempts 만 또 소진하고 같은 자리로 돌아온다. 확인은 masterId 단위라, 이벤트가
 * 수천 건이어도 호출은 상품 수만큼이다.
 *
 * 새벽에 도는 이유는 되살린 이벤트가 낮 작업과 같은 큐를 쓰기 때문이다.
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
    const failures = await this.dbService.db
      .select({ id: inboxEvents.id, payload: inboxEvents.payload })
      .from(inboxEvents)
      .where(
        and(
          eq(inboxEvents.status, 'failed'),
          eq(inboxEvents.eventType, 'ProductSellableQuantityChanged'),
          like(inboxEvents.errorMessage, `${PRODUCT_NOT_FOUND_PREFIX}%`),
        ),
      );

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
        // 조회 자체가 실패한 상품은 이번 회차만 건너뛴다. failed 로 남아 있으니 내일 다시 본다.
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
        .where(inArray(inboxEvents.id, reviveIds));
    }

    this.logger.log(
      `되살리기 완료: ${reviveIds.length}건 pending 전환 | ` +
        `아직 상품 없음 ${stillMissing}개 | 조회 실패 ${lookupFailed}개`,
    );
  }
}
