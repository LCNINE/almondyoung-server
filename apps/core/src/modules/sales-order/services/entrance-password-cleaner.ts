import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { and, asc, inArray, isNotNull } from 'drizzle-orm';
import { wmsSchema, wmsTables, type DbTx } from '../../inventory/schema/inventory.schema';
import { computeEntrancePasswordExpiry } from './entrance-password-expiry';

/**
 * 한 틱에 훑는 후보 수의 상한. 비번을 들고 있는 행은 TTL(14일) 안에 만들어진 것뿐이라
 * 실제로는 수백 건 규모지만, 상한이 없으면 사고가 났을 때 틱 하나가 무한정 길어진다.
 * 넘친 분은 다음 틱이 가져간다 — 스윕은 몇 번을 돌아도 결과가 같다.
 */
export const ENTRANCE_PASSWORD_SWEEP_BATCH = 500;

export interface EntrancePasswordSweepResult {
  /** 비운 판매주문 수. 값은 절대 로그에 남기지 않는다 — 건수만 남긴다. */
  orders: number;
  /** 비운 상자 사본 수. */
  shipments: number;
}

/**
 * 파기할 판매주문을 고른다.
 *
 * `entrance_password_expires_at` 이 **없는 행은 건드리지 않는다**. 지금은 이 컬럼 쌍을
 * 한 번에 쓰는 경로가 `SalesOrdersService.create` 하나뿐이라 그런 행이 생길 수 없지만,
 * 만약 생긴다면 "만료를 모른다"는 뜻이지 "만료됐다"는 뜻이 아니다. 아직 오지 않은 배송의
 * 비번을 지워버리면 송장에 현관 정보가 빠진 채 나가고 그건 되돌릴 수 없다 — 그래서 이쪽
 * 방향으로만 실수한다. 대신 호출자가 그런 행의 수를 경고로 남겨 조용한 적체를 드러낸다.
 */
export function expiredEntrancePasswordOrderIds(
  rows: { id: string; entrancePasswordExpiresAt: Date | null }[],
  now: Date,
): string[] {
  return rows
    .filter((row) => row.entrancePasswordExpiresAt !== null && row.entrancePasswordExpiresAt.getTime() <= now.getTime())
    .map((row) => row.id);
}

/**
 * 파기할 상자 사본을 고른다.
 *
 * 상자에는 자체 만료 컬럼이 없다 — 사본이 만들어진 시각에 **주문과 같은 TTL** 을 얹어
 * 판정한다(`computeEntrancePasswordExpiry` 를 그대로 재사용하므로 14 라는 숫자가 여기 다시
 * 적히지 않는다).
 *
 * 주문을 거쳐 조인하지 않는 이유가 둘 있다. (1) 운영자 정정은 상자 사본만 바꾸므로 두 값이
 * 갈릴 수 있고, (2) 배송 완료 파기가 주문 쪽 만료 시각까지 비우므로 형제 상자가 남았을 때
 * 주문을 기준으로는 더 이상 아무 것도 판정할 수 없다. 각 행이 자기 시각을 들고 있어야
 * 어느 경우에도 파기가 도달한다.
 */
export function expiredEntrancePasswordShipmentIds(rows: { id: string; createdAt: Date }[], now: Date): string[] {
  return rows
    .filter((row) => computeEntrancePasswordExpiry(row.createdAt.toISOString()).getTime() <= now.getTime())
    .map((row) => row.id);
}

/**
 * 보관 상한을 넘긴 공동현관 비번을 파기하는 백스톱 배치.
 *
 * 1차 파기는 배송 완료 시점이다(`ShipmentDeliveryTrackingService`). 이건 **배송 완료에 끝내
 * 도달하지 못한 건**을 위한 것이다 — 취소·반품·미출고로 멈춘 주문, 발행되지 않은 상자.
 * 그런 건에는 파기 신호가 영영 오지 않으므로 시간이 유일한 기준이 된다.
 *
 * **킬스위치를 두지 않았다.** 다른 워커들과 달리 이건 개인정보 파기 의무를 이행하는 코드이고,
 * env 하나로 조용히 꺼질 수 있으면 그 사실을 아무도 모르는 채로 보관이 계속된다.
 *
 * 하루 한 번으로 충분하다 — 상한이 14일인데 하루의 지연은 의미가 없다.
 */
@Injectable()
export class EntrancePasswordCleaner {
  private readonly logger = new Logger(EntrancePasswordCleaner.name);
  private isSweeping = false;

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly db: DbService<typeof wmsSchema>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async sweep(): Promise<void> {
    if (this.isSweeping) {
      this.logger.debug('이전 공동현관 비번 파기 스윕 진행 중, 건너뜀');
      return;
    }
    this.isSweeping = true;
    try {
      const { orders, shipments } = await this.sweepOnce(new Date());
      if (orders > 0 || shipments > 0) {
        this.logger.log(`만료된 공동현관 비번 파기 (주문 ${orders}건, 상자 ${shipments}건)`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      this.logger.error(`공동현관 비번 파기 스윕 실패: ${message}`, error instanceof Error ? error.stack : undefined);
    } finally {
      this.isSweeping = false;
    }
  }

  /**
   * 한 배치를 파기한다. `now` 를 인자로 받는 이유는 테스트가 시계를 고정할 수 있어야 하기
   * 때문이다.
   *
   * 파기는 컬럼을 null 로 만드는 것이다 — 행은 지우지 않는다. `IS NOT NULL` 술어가 두 번째
   * 방어선이자 **잠금 범위 축소**다: 이미 비어 있는 절대다수의 행은 아예 잠기지 않으므로
   * 스윕이 다른 트랜잭션과 만날 표면이 최소가 된다. 그래서 같은 스윕을 몇 번이고 다시
   * 돌려도 두 번째부터는 0행이다.
   *
   * 상자를 주문보다 먼저 비우는 순서는 배송 완료 파기 경로와 같다 — 두 경로가 같은 순서로
   * 행을 잡아야 서로 교착하지 않는다.
   */
  async sweepOnce(now: Date, tx?: DbTx): Promise<EntrancePasswordSweepResult> {
    return this.db.run(async (trx) => {
      const orderCandidates = await trx
        .select({
          id: wmsTables.salesOrders.id,
          entrancePasswordExpiresAt: wmsTables.salesOrders.entrancePasswordExpiresAt,
        })
        .from(wmsTables.salesOrders)
        .where(isNotNull(wmsTables.salesOrders.entrancePassword))
        // ASC 는 NULL 을 뒤로 보낸다 — 만료 시각이 없는 행이 배치를 굶기지 않는다.
        .orderBy(asc(wmsTables.salesOrders.entrancePasswordExpiresAt))
        .limit(ENTRANCE_PASSWORD_SWEEP_BATCH);

      const shipmentCandidates = await trx
        .select({ id: wmsTables.shipments.id, createdAt: wmsTables.shipments.createdAt })
        .from(wmsTables.shipments)
        .where(isNotNull(wmsTables.shipments.entrancePassword))
        .orderBy(asc(wmsTables.shipments.createdAt))
        .limit(ENTRANCE_PASSWORD_SWEEP_BATCH);

      const unanchored = orderCandidates.filter((row) => row.entrancePasswordExpiresAt === null).length;
      if (unanchored > 0) {
        this.logger.warn(`만료 시각 없는 공동현관 비번 ${unanchored}건 — 파기 시점을 판단할 수 없어 남긴다`);
      }

      const expiredOrders = expiredEntrancePasswordOrderIds(orderCandidates, now);
      const expiredShipments = expiredEntrancePasswordShipmentIds(shipmentCandidates, now);

      const purgedShipments =
        expiredShipments.length === 0
          ? []
          : await trx
              .update(wmsTables.shipments)
              .set({ entrancePassword: null })
              .where(
                and(inArray(wmsTables.shipments.id, expiredShipments), isNotNull(wmsTables.shipments.entrancePassword)),
              )
              .returning({ id: wmsTables.shipments.id });

      const purgedOrders =
        expiredOrders.length === 0
          ? []
          : await trx
              .update(wmsTables.salesOrders)
              .set({ entrancePassword: null, entrancePasswordExpiresAt: null })
              .where(
                and(
                  inArray(wmsTables.salesOrders.id, expiredOrders),
                  isNotNull(wmsTables.salesOrders.entrancePassword),
                ),
              )
              .returning({ id: wmsTables.salesOrders.id });

      return { orders: purgedOrders.length, shipments: purgedShipments.length };
    }, tx);
  }
}
