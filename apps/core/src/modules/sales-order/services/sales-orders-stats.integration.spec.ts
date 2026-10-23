// jest moduleNameMapper 가 bare `@packages/event-contracts` 를 못 잡아 module-not-found 로 죽는다.
// 매핑되는 서브패스로 requireActual 하는 것이 이 레포의 상시 우회다.
jest.mock(
  '@packages/event-contracts',
  () => jest.requireActual<typeof import('@packages/event-contracts')>('@packages/event-contracts/index'),
  { virtual: true },
);

import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import * as f from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { seedDispatchedParcel } from '../line-quantities/__support__/shipment-facts.fixtures';
import { SalesOrdersService } from './sales-orders.service';

/**
 * 주문 현황 칩(관리자 메인 + 통계 종합 탭)이 세는 7개 숫자를 실 Postgres 로 고정한다.
 *
 * 이 숫자들은 화면의 첫 인상이라 정의가 조용히 바뀌면 티가 안 난다. 출고 불가는
 * 정체 보드(`order_progress`)의 «예약» 단계에서 센다 — 보드 칸 숫자와 같은 값이어야 한다(스펙 D9).
 * 부분 출고·출고완료는 진행 중 주문(14일)의 라인 수량으로 센다(K6 PR2b, R14).
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

  /** 14일 안 주문(기본 confirmed) 하나 + FO(수량 qty) 하나. 상자는 호출자가 만든다 */
  async function splitOrder(
    trx: DbTx,
    w: f.World,
    args: {
      qty: number;
      dropShip?: 'forwarded' | 'completed';
      status?: 'pending' | 'confirmed' | 'shipped';
      daysAgo?: number;
    },
  ) {
    const o = await f.seedOrder(trx, {
      status: args.status ?? 'confirmed',
      createdAt: kstDaysAgoNoon(args.daysAgo ?? 1),
      quantity: args.qty,
    });
    const fo = await f.seedFo(trx, w, o, { status: 'processing', qty: args.qty, dropShip: args.dropShip });
    return { ...o, ...fo };
  }

  it('나눠 보낸 주문은 부분출고다 — 한 상자만 발송되고 남은 상자는 피킹 단계', async () => {
    const delta = await withFixtures(async ({ trx }) => {
      const w = await f.seedWorld(trx);
      const o = await splitOrder(trx, w, { qty: 3 });
      const sent = await f.seedBox(trx, w, [o.foItemId], { status: 'planned', qty: [1] });
      await f.seedBox(trx, w, [o.foItemId], { status: 'planned', qty: [2] });
      await seedDispatchedParcel(trx, w, {
        shipmentId: sent.shipmentId,
        lines: [{ shipmentLineId: sent.lineIds[0], foItemId: o.foItemId, qty: 1 }],
      });
    });

    expect(delta.partialOutbound).toBe(1);
    expect(delta.outboundComplete).toBe(0);
  });

  // 모집단은 진행 중 주문(SO pending·confirmed·processing, 14일)이다 — 라이브 진행 중 주문은 pending 이다(R14).
  // 생성이 pending 으로 넣고 confirm 은 관리자 엔드포인트뿐이라, confirmed 만 세면 카드가 0 에 머문다.
  it('pending order counts as partial outbound', async () => {
    const delta = await withFixtures(async ({ trx }) => {
      const w = await f.seedWorld(trx);
      const o = await splitOrder(trx, w, { qty: 3, status: 'pending' });
      const sent = await f.seedBox(trx, w, [o.foItemId], { status: 'planned', qty: [1] });
      await f.seedBox(trx, w, [o.foItemId], { status: 'planned', qty: [2] });
      await seedDispatchedParcel(trx, w, {
        shipmentId: sent.shipmentId,
        lines: [{ shipmentLineId: sent.lineIds[0], foItemId: o.foItemId, qty: 1 }],
      });
    });

    expect(delta.partialOutbound).toBe(1);
    expect(delta.outboundComplete).toBe(0);
  });

  it('전량 발송된 주문은 출고완료다', async () => {
    const delta = await withFixtures(async ({ trx }) => {
      const w = await f.seedWorld(trx);
      const o = await splitOrder(trx, w, { qty: 3 });
      const box = await f.seedBox(trx, w, [o.foItemId], { status: 'planned', qty: [3] });
      await seedDispatchedParcel(trx, w, {
        shipmentId: box.shipmentId,
        lines: [{ shipmentLineId: box.lineIds[0], foItemId: o.foItemId, qty: 3 }],
      });
    });

    expect(delta.outboundComplete).toBe(1);
    expect(delta.partialOutbound).toBe(0);
  });

  it('상자가 둘 움직여도 주문 하나로 센다', async () => {
    const delta = await withFixtures(async ({ trx }) => {
      const w = await f.seedWorld(trx);
      const o = await splitOrder(trx, w, { qty: 3 });
      const one = await f.seedBox(trx, w, [o.foItemId], { status: 'planned', qty: [1] });
      const two = await f.seedBox(trx, w, [o.foItemId], { status: 'planned', qty: [1] });
      await f.seedBox(trx, w, [o.foItemId], { status: 'planned', qty: [1] });
      for (const box of [one, two]) {
        await seedDispatchedParcel(trx, w, {
          shipmentId: box.shipmentId,
          lines: [{ shipmentLineId: box.lineIds[0], foItemId: o.foItemId, qty: 1 }],
        });
      }
    });

    expect(delta.partialOutbound).toBe(1);
    expect(delta.outboundComplete).toBe(0);
  });

  it('넘기기만 한 직배는 어느 쪽도 아니다', async () => {
    const delta = await withFixtures(async ({ trx }) => {
      const w = await f.seedWorld(trx);
      await splitOrder(trx, w, { qty: 2, dropShip: 'forwarded' });
    });

    expect(delta.partialOutbound).toBe(0);
    expect(delta.outboundComplete).toBe(0);
  });

  it('셀메이트로 나간 주문(SO shipped)은 모집단 밖이다', async () => {
    const delta = await withFixtures(async ({ trx }) => {
      const w = await f.seedWorld(trx);
      const o = await splitOrder(trx, w, { qty: 2, status: 'shipped' });
      await trx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ shippedQty: 2 })
        .where(eq(wmsTables.fulfillmentOrderItems.id, o.foItemId));
    });

    expect(delta.partialOutbound).toBe(0);
    expect(delta.outboundComplete).toBe(0);
  });

  it('FO 의 shipped_at·status 만으로는 출고완료가 아니다 — 나간 수량이 없다', async () => {
    const delta = await withFixtures(async ({ order }) => {
      await order({ status: 'confirmed', orderDate: kstDaysAgoNoon(1), fo: { status: 'shipped' } });
      // pending 도 모집단이다(R14) — 거기서도 FO 상태만으로는 세지 않는다
      await order({ status: 'pending', orderDate: kstDaysAgoNoon(1), fo: { status: 'shipped' } });
      await order({
        status: 'confirmed',
        orderDate: kstDaysAgoNoon(3),
        fo: { status: 'created', shippedAt: kstDaysAgoNoon(3) },
      });
    });

    expect(delta.outboundComplete).toBe(0);
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
