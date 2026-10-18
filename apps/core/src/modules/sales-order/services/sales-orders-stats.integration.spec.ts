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
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import * as f from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { SalesOrdersService } from './sales-orders.service';

/**
 * 주문 현황 칩(관리자 메인 + 통계 종합 탭)이 세는 7개 숫자를 실 Postgres 로 고정한다.
 *
 * 이 숫자들은 화면의 첫 인상이라 정의가 조용히 바뀌면 티가 안 난다. 출고 불가/부분 출고는
 * 정체 보드(`order_progress`)의 «예약» 단계에서 센다 — 보드 칸 숫자와 같은 값이어야 한다(스펙 D9).
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
      trx: DbTx;
      order: (o: {
        status: string;
        orderDate: Date;
        fo?: { mode?: string; status?: string; shippedAt?: Date | null };
        backlogStatus?: string;
      }) => Promise<string>;
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
          trx: trx as unknown as DbTx,
          order: async ({ status, orderDate, fo, backlogStatus }) => {
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

            return row.id;
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

  /** 주문의 첫 라인 id — seedFo 가 라인 구성을 굳히는 데 쓴다 */
  async function lineOf(trx: DbTx, salesOrderId: string): Promise<string> {
    const [line] = await trx
      .insert(wmsTables.salesOrderLines)
      .values({ salesOrderId, variantId: randomUUID(), productName: 'fixture', quantity: 1 })
      .returning({ id: wmsTables.salesOrderLines.id });
    return line.id;
  }

  /** 보드 투영 행 하나. stage 를 안 주면 종료(outcome) 행이다 */
  async function progress(
    trx: DbTx,
    salesOrderId: string,
    row: { stage: string | null; outcome?: string | null },
  ): Promise<void> {
    const now = new Date();
    await trx.insert(wmsTables.orderProgress).values({
      salesOrderId,
      salesChannel: 'medusa',
      orderedAt: now,
      stage: row.stage,
      state: row.stage ? 'created' : null,
      stageEnteredAt: now,
      outcome: row.outcome ?? null,
      closedAt: row.outcome ? now : null,
      evaluatedAt: now,
    });
  }

  it('출고 불가는 보드 «예약» 단계의 진행 중 주문 수다 — 기간·주문 상태 창이 없다', async () => {
    const delta = await withFixtures(async ({ trx, order }) => {
      // 14일보다 오래된 주문이어도, confirmed 가 아니어도 보드 «예약» 칸에 있으면 센다
      const a = await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(1) });
      const b = await order({ status: 'pending', orderDate: kstDaysAgoNoon(30) });
      // 다른 단계의 진행 중 주문은 아니다
      const plan = await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(1) });
      // 종료된 주문은 아니다(stage 가 NULL 이거나 outcome 이 있다)
      const closed = await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(1) });
      await progress(trx, a, { stage: 'reserve' });
      await progress(trx, b, { stage: 'reserve' });
      await progress(trx, plan, { stage: 'plan' });
      await progress(trx, closed, { stage: null, outcome: 'shipped_external' });
    });

    expect(delta.cannotShip).toBe(2);
    expect(delta.partialOutbound).toBe(0);
  });

  it('부분 출고는 그중 다른 상자가 이미 움직인 주문이다', async () => {
    const delta = await withFixtures(async ({ trx, order }) => {
      const w = await f.seedWorld(trx);

      // «예약» 단계 주문마다 미예약 draft 상자 하나 + 다른 상자 하나를 둔다
      const reserveOrderWith = async (
        otherBox: 'shipped' | 'in_transit' | 'failed' | 'delivered' | 'draft' | 'canceled' | null,
      ) => {
        const id = await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(1) });
        const fo = await f.seedFo(trx, w, { salesOrderId: id, lineId: await lineOf(trx, id) }, { status: 'created' });
        await f.seedBox(trx, w, [fo.foItemId], { status: 'draft' });
        if (otherBox) await f.seedBox(trx, w, [fo.foItemId], { status: otherBox });
        await progress(trx, id, { stage: 'reserve' });
        return { id, fo };
      };

      // 움직인 상자 넷은 각각 부분 출고다
      await reserveOrderWith('shipped');
      await reserveOrderWith('in_transit');
      await reserveOrderWith('failed');
      await reserveOrderWith('delivered');
      // 움직이지 않았거나(draft·canceled) 상자가 하나뿐이면 아니다
      await reserveOrderWith('draft');
      await reserveOrderWith('canceled');
      await reserveOrderWith(null);

      // «예약» 이 아닌 단계의 주문은 상자가 움직였어도 센 쪽에 들지 않는다
      const planId = await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(1) });
      const planFo = await f.seedFo(
        trx,
        w,
        { salesOrderId: planId, lineId: await lineOf(trx, planId) },
        { status: 'processing' },
      );
      await f.seedBox(trx, w, [planFo.foItemId], { status: 'shipped' });
      await progress(trx, planId, { stage: 'plan' });
    });

    expect(delta.cannotShip).toBe(7);
    expect(delta.partialOutbound).toBe(4);
  });

  it('상자가 둘 이상 움직였어도 주문 하나로 센다', async () => {
    const delta = await withFixtures(async ({ trx, order }) => {
      const w = await f.seedWorld(trx);
      const id = await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(1) });
      const fo = await f.seedFo(trx, w, { salesOrderId: id, lineId: await lineOf(trx, id) }, { status: 'created' });
      await f.seedBox(trx, w, [fo.foItemId], { status: 'draft' });
      await f.seedBox(trx, w, [fo.foItemId], { status: 'shipped' });
      await f.seedBox(trx, w, [fo.foItemId], { status: 'delivered' });
      await progress(trx, id, { stage: 'reserve' });
    });

    expect(delta.cannotShip).toBe(1);
    expect(delta.partialOutbound).toBe(1);
  });

  it('출고완료는 FO 의 출고 증거로 판정한다 — status 든 shippedAt 이든 하나면 된다', async () => {
    const delta = await withFixtures(async ({ order }) => {
      await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(1), fo: { status: 'shipped' } });
      await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(2), fo: { status: 'completed' } });
      // status 는 아직 created 지만 출고 시각이 찍혔다
      await order({
        status: 'confirmed',
        orderDate: kstDaysAgoNoon(3),
        fo: { status: 'created', shippedAt: kstDaysAgoNoon(3) },
      });
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
