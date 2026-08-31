// jest moduleNameMapper 가 bare `@packages/event-contracts` 를 못 잡아 module-not-found 로 죽는다.
// 매핑되는 서브패스로 requireActual 하는 것이 이 레포의 상시 우회다.
jest.mock(
  '@packages/event-contracts',
  () => jest.requireActual<typeof import('@packages/event-contracts')>('@packages/event-contracts/index'),
  { virtual: true },
);

import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { SalesOrdersService } from './sales-orders.service';

/**
 * 주문 현황 칩(관리자 메인 + 통계 종합 탭)이 세는 7개 숫자를 실 Postgres 로 고정한다.
 *
 * 이 숫자들은 화면의 첫 인상이라 정의가 조용히 바뀌면 티가 안 난다. 특히 출고 불가/부분 출고는
 * 주문 하나가 여러 라인을 갖는 집합 질문이라, 라인 단위로 세면 조용히 부풀어 오른다.
 *
 * 기존 행이 남아 있는 DB 에서도 돌 수 있게 **넣기 전/후의 차이**를 본다.
 * 각 테스트는 트랜잭션 안에서 픽스처를 넣고 항상 롤백한다 — DB 에 아무것도 남지 않는다.
 *
 * 실행: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest sales-orders-stats.integration`
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

/** KST 달력일 기준으로 n일 전의 정오 — 경계에 걸리지 않는 안전한 시각 */
function kstDaysAgoNoon(days: number): Date {
  const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
  const day = new Date(Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate() - days, 3, 0, 0));
  return day; // UTC 03:00 = KST 정오
}

describeIfDb('주문 현황 통계 (실 Postgres)', () => {
  jest.setTimeout(120_000);

  let sql: postgres.Sql;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
  });

  afterAll(async () => {
    await sql.end();
  });

  /** 트랜잭션 안에서 픽스처를 넣고 stats 를 재고 항상 롤백한다. */
  async function withFixtures(
    seed: (t: {
      order: (o: {
        status: string;
        orderDate: Date;
        lineStatuses?: string[];
        fo?: { mode?: string; status?: string; shippedAt?: Date | null };
        backlogStatus?: string;
      }) => Promise<void>;
    }) => Promise<void>,
  ) {
    const db = drizzle(sql);
    let before!: Awaited<ReturnType<SalesOrdersService['getStats']>>;
    let after!: Awaited<ReturnType<SalesOrdersService['getStats']>>;

    try {
      await db.transaction(async (trx) => {
        const service = new SalesOrdersService(
          { db: trx } as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
        );

        before = await service.getStats();

        await seed({
          order: async ({ status, orderDate, lineStatuses = [], fo, backlogStatus }) => {
            const [row] = await trx
              .insert(wmsTables.salesOrders)
              .values({
                channelOrderId: randomUUID(),
                salesChannel: 'medusa',
                status: status as never,
                shippingAddress: {},
                orderDate,
              })
              .returning({ id: wmsTables.salesOrders.id });

            for (const lineStatus of lineStatuses) {
              await trx.insert(wmsTables.salesOrderLines).values({
                salesOrderId: row.id,
                variantId: randomUUID(),
                productName: 'fixture',
                quantity: 1,
                status: lineStatus as never,
              });
            }

            if (fo) {
              await trx.insert(wmsTables.fulfillmentOrders).values({
                salesOrderId: row.id,
                status: (fo.status ?? 'created') as never,
                fulfillmentMode: (fo.mode ?? null) as never,
                shippedAt: fo.shippedAt ?? null,
              });
            }

            if (backlogStatus) {
              await trx.insert(wmsTables.fulfillmentOrderCreationBacklogs).values({
                salesOrderId: row.id,
                status: backlogStatus as never,
              });
            }
          },
        });

        after = await service.getStats();
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }

    const delta = {} as Record<keyof typeof after, number>;
    for (const key of Object.keys(after) as Array<keyof typeof after>) {
      delta[key] = after[key] - before[key];
    }
    return delta;
  }

  it('출고 불가는 주문 단위로 센다 — 못 나가는 라인이 여러 개여도 주문 하나다', async () => {
    const delta = await withFixtures(async ({ order }) => {
      // 못 나가는 라인 3개짜리 주문 하나. 라인 단위로 세면 3 이 된다.
      await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(1), lineStatuses: ['stock_unavailable', 'stock_unavailable', 'stock_unavailable'] });
    });

    expect(delta.cannotShip).toBe(1);
    expect(delta.partialOutbound).toBe(0);
  });

  it('부분 출고는 출고 불가 주문 중 이미 차감된 라인이 있는 것만이다', async () => {
    const delta = await withFixtures(async ({ order }) => {
      // 못 나가는 라인 + 이미 차감된 라인 → 출고 불가이면서 부분 출고
      await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(1), lineStatuses: ['stock_unavailable', 'stock_deducted'] });
      // 못 나가는 라인만 → 출고 불가지만 부분 출고는 아님
      await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(2), lineStatuses: ['stock_unavailable'] });
      // 차감된 라인만 → 어느 쪽도 아님
      await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(3), lineStatuses: ['stock_deducted'] });
    });

    expect(delta.cannotShip).toBe(2);
    expect(delta.partialOutbound).toBe(1);
  });

  it('기간 밖과 confirmed 아닌 주문은 출고 불가에서 빠진다', async () => {
    const delta = await withFixtures(async ({ order }) => {
      await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(30), lineStatuses: ['stock_unavailable'] });
      await order({ status: 'pending', orderDate: kstDaysAgoNoon(1), lineStatuses: ['stock_unavailable'] });
    });

    expect(delta.cannotShip).toBe(0);
    expect(delta.partialOutbound).toBe(0);
  });

  it('출고완료는 FO 의 출고 증거로 판정한다 — status 든 shippedAt 이든 하나면 된다', async () => {
    const delta = await withFixtures(async ({ order }) => {
      await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(1), fo: { status: 'shipped' } });
      await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(2), fo: { status: 'completed' } });
      // status 는 아직 created 지만 출고 시각이 찍혔다
      await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(3), fo: { status: 'created', shippedAt: kstDaysAgoNoon(3) } });
      // 출고 증거 없음
      await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(4), fo: { status: 'created' } });
    });

    expect(delta.outboundComplete).toBe(3);
  });

  it('오늘 주문·출고 요청·직송·매칭 대기를 각각 센다', async () => {
    const delta = await withFixtures(async ({ order }) => {
      await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(0) });
      await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(2), fo: { mode: 'drop_ship' } });
      await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(2), backlogStatus: 'awaiting_matching' });
      // 매칭 대기가 아닌 백로그는 빠진다
      await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(2), backlogStatus: 'pending' });
    });

    expect(delta.todayCount).toBe(1);
    expect(delta.outboundRequested).toBe(4);
    expect(delta.directShip).toBe(1);
    expect(delta.waitingMatching).toBe(1);
  });
});
