import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray } from 'drizzle-orm';
import { DbService } from '@app/db';
import { channelAdapterSchema, inboxEvents } from '../../schema';

const DEFAULT_SETTLE_MS = 300000;

/**
 * Medusa 예약을 «줄이는» 쓰기의 게이트 (#1247). 가용재고 이벤트(`ProductSellableQuantityChanged`)가 아직 처리 전이면
 * 예약을 줄이는 순간 Medusa 재고가 잠깐 부풀어 오버셀이 난다 — 그 variant 의 감소를 막는다.
 * 스냅샷이 정착 지연보다 새것이면 이벤트가 아직 inbox 에 닿지 않았을 수 있으므로 전부 막는다.
 */
@Injectable()
export class SellableSettleGate {
  private readonly settleMs: number;

  constructor(
    private readonly dbService: DbService<typeof channelAdapterSchema>,
    configService: ConfigService,
  ) {
    // 비었거나 숫자가 아니거나 0 이하면 기본값 — 게이트가 «지연 0»으로 열리면 안 된다.
    const configured = Number(configService.get<string | number>('RESERVATION_PROJECTION_SETTLE_MS', DEFAULT_SETTLE_MS));
    this.settleMs = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SETTLE_MS;
  }

  async blockedVariantIds(variantIds: string[], asOf: Date, now: Date): Promise<Set<string>> {
    const unique = [...new Set(variantIds)];
    if (unique.length === 0) return new Set();
    // asOf 를 읽을 수 없으면 얼마나 오래됐는지 모른다 — 전부 막는다.
    if (Number.isNaN(asOf.getTime()) || now.getTime() - asOf.getTime() < this.settleMs) return new Set(unique);

    const rows = await this.dbService.db
      .select({ aggregateId: inboxEvents.aggregateId })
      .from(inboxEvents)
      .where(
        and(
          eq(inboxEvents.eventType, 'ProductSellableQuantityChanged'),
          inArray(inboxEvents.aggregateId, unique),
          inArray(inboxEvents.status, ['pending', 'processing']),
        ),
      );
    return new Set(rows.map((row) => row.aggregateId));
  }
}
