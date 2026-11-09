import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray } from 'drizzle-orm';
import { DbService } from '@app/db';
import { channelAdapterSchema, inboxEvents } from '../../schema';

export type SettleGateDb = Pick<DbService<typeof channelAdapterSchema>, 'db'>;

/**
 * Medusa 예약을 «줄이는» 쓰기의 게이트 (#1247). 가용재고 이벤트(`ProductSellableQuantityChanged`)가 아직 처리 전이면
 * 예약을 줄이는 순간 Medusa 재고가 잠깐 부풀어 오버셀이 난다 — 그 variant 의 감소를 막는다.
 * 스냅샷이 정착 지연보다 새것이면 이벤트가 아직 inbox 에 닿지 않았을 수 있으므로 전부 막는다.
 */
@Injectable()
export class SellableSettleGate {
  private readonly settleMs: number;

  constructor(
    private readonly dbService: SettleGateDb,
    configService: ConfigService,
  ) {
    this.settleMs = Number(configService.get<number>('RESERVATION_PROJECTION_SETTLE_MS', 300000));
  }

  async blockedVariantIds(variantIds: string[], asOf: Date, now: Date): Promise<Set<string>> {
    const unique = [...new Set(variantIds)];
    if (unique.length === 0) return new Set();
    if (now.getTime() - asOf.getTime() < this.settleMs) return new Set(unique);

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
