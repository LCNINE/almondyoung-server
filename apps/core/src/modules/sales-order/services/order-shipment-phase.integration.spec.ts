// jest moduleNameMapper 가 bare `@packages/event-contracts` 를 못 잡아 module-not-found 로 죽는다.
// 매핑되는 서브패스로 requireActual 하는 것이 이 레포의 상시 우회다.
jest.mock(
  '@packages/event-contracts',
  () => jest.requireActual<typeof import('@packages/event-contracts')>('@packages/event-contracts/index'),
  { virtual: true },
);

import * as postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import * as f from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { OrderShipmentPhase, orderShipmentPhaseSql } from './order-shipment-phase.sql';
import { SalesOrdersService } from './sales-orders.service';

/**
 * 주문 출고 단계 정의 한 벌(`orderShipmentPhaseSql`)과, 그것을 읽는 일별 통계를 실 Postgres 로 고정한다.
 * 각 테스트는 트랜잭션 안에서 픽스처를 넣고 항상 롤백한다.
 *
 * 실행: `DATABASE_URL=postgresql://… npx jest --runInBand --runTestsByPath <이 파일>`
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

type OrderStatus = 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
type BoxStatus = Parameters<typeof f.seedBox>[3]['status'];
type PhaseRow = { sales_order_id: string; phase: OrderShipmentPhase };

describeIfDb('orderShipmentPhaseSql (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2 });
    db = drizzle(client, { schema: wmsSchema });
  });
  afterAll(async () => {
    await client.end();
  });

  async function rollback(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (rawTx) => {
        await fn(rawTx as unknown as DbTx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  }

  async function readPhases(tx: DbTx, scope: ReturnType<typeof sql>): Promise<PhaseRow[]> {
    return (await tx.execute(orderShipmentPhaseSql(scope))) as unknown as PhaseRow[];
  }

  /** 주문 하나 + 상자들(상태별) 을 넣고 단계를 읽는다 */
  async function phaseOf(
    tx: DbTx,
    w: f.World,
    status: OrderStatus,
    boxes: BoxStatus[],
    createdAt?: Date,
  ): Promise<{ id: string; phase: OrderShipmentPhase }> {
    const o = await f.seedOrder(tx, { status, createdAt });
    if (boxes.length > 0) {
      const fo = await f.seedFo(tx, w, o, { status: 'processing' });
      for (const b of boxes) await f.seedBox(tx, w, [fo.foItemId], { status: b });
    }
    const rows = await readPhases(tx, sql`SELECT ${o.salesOrderId}::uuid`);
    expect(rows).toHaveLength(1);
    return { id: o.salesOrderId, phase: rows[0].phase };
  }

  it('상자 없는 셀메이트 shipped·delivered 주문은 external_shipped', async () => {
    await rollback(async (tx) => {
      const w = await f.seedWorld(tx);
      expect((await phaseOf(tx, w, 'shipped', [])).phase).toBe('external_shipped');
      expect((await phaseOf(tx, w, 'delivered', [])).phase).toBe('external_shipped');
    });
  });

  it('셀메이트 shipped 인데 core 상자도 있으면 external_shipped 가 이긴다', async () => {
    await rollback(async (tx) => {
      const w = await f.seedWorld(tx);
      expect((await phaseOf(tx, w, 'shipped', ['draft'])).phase).toBe('external_shipped');
      expect((await phaseOf(tx, w, 'delivered', ['delivered'])).phase).toBe('external_shipped');
    });
  });

  it('취소 주문은 남은 상자가 있어도 cancelled', async () => {
    await rollback(async (tx) => {
      const w = await f.seedWorld(tx);
      expect((await phaseOf(tx, w, 'cancelled', ['shipped'])).phase).toBe('cancelled');
      expect((await phaseOf(tx, w, 'cancelled', [])).phase).toBe('cancelled');
    });
  });

  it('결제 대기 주문은 상자와 무관하게 pending', async () => {
    await rollback(async (tx) => {
      const w = await f.seedWorld(tx);
      expect((await phaseOf(tx, w, 'pending', [])).phase).toBe('pending');
      expect((await phaseOf(tx, w, 'pending', ['shipped'])).phase).toBe('pending');
    });
  });

  it('상자 둘 중 하나만 발송이면 shipping, 둘 다 delivered 면 delivered, 상자 없는 confirmed 는 preparing', async () => {
    await rollback(async (tx) => {
      const w = await f.seedWorld(tx);
      expect((await phaseOf(tx, w, 'confirmed', ['shipped', 'draft'])).phase).toBe('shipping');
      expect((await phaseOf(tx, w, 'confirmed', ['delivered', 'planned'])).phase).toBe('shipping');
      expect((await phaseOf(tx, w, 'confirmed', ['in_transit'])).phase).toBe('shipping');
      expect((await phaseOf(tx, w, 'confirmed', ['delivered', 'delivered'])).phase).toBe('delivered');
      expect((await phaseOf(tx, w, 'confirmed', [])).phase).toBe('preparing');
      expect((await phaseOf(tx, w, 'confirmed', ['draft', 'planned'])).phase).toBe('preparing');
    });
  });

  it('취소된 상자는 단계 판정에서 빠진다', async () => {
    await rollback(async (tx) => {
      const w = await f.seedWorld(tx);
      // 살아 있는 상자가 delivered 하나뿐이면 취소된 상자가 있어도 delivered
      expect((await phaseOf(tx, w, 'confirmed', ['delivered', 'canceled'])).phase).toBe('delivered');
      // 취소 상자만 있으면 상자가 없는 것과 같다
      expect((await phaseOf(tx, w, 'confirmed', ['canceled'])).phase).toBe('preparing');
    });
  });

  it('직배(drop_ship)는 direct_ship_status 로 센다 — forwarded 는 움직임, completed 는 delivered', async () => {
    await rollback(async (tx) => {
      const w = await f.seedWorld(tx);
      const phaseOfDropShip = async (dropShip: 'pending' | 'forwarded' | 'completed' | 'canceled') => {
        const o = await f.seedOrder(tx, { status: 'confirmed' });
        await f.seedFo(tx, w, o, { status: 'processing', dropShip });
        const rows = await readPhases(tx, sql`SELECT ${o.salesOrderId}::uuid`);
        return rows[0].phase;
      };
      expect(await phaseOfDropShip('pending')).toBe('preparing');
      expect(await phaseOfDropShip('forwarded')).toBe('shipping');
      expect(await phaseOfDropShip('completed')).toBe('delivered');
      expect(await phaseOfDropShip('canceled')).toBe('preparing');
    });
  });

  it('범위에 든 주문마다 정확히 한 행을 낸다', async () => {
    await rollback(async (tx) => {
      const w = await f.seedWorld(tx);
      const a = await phaseOf(tx, w, 'confirmed', ['shipped', 'delivered', 'draft']);
      const b = await phaseOf(tx, w, 'confirmed', []);
      const rows = await readPhases(tx, sql`SELECT x::uuid FROM unnest(ARRAY[${a.id}, ${b.id}]::text[]) AS x`);
      expect(rows).toHaveLength(2);
      expect(Object.fromEntries(rows.map((r) => [r.sales_order_id, r.phase]))).toEqual({
        [a.id]: 'shipping',
        [b.id]: 'preparing',
      });
    });
  });

  it('일별 통계는 셀메이트 출고분을 externalShipped 로 세고 preparing 에서 뺀다', async () => {
    // 오래된 날짜를 골라 기존 행이 거의 없게 하되, 남은 행이 있어도 되도록 넣기 전/후 차이를 본다
    const day = new Date(Date.UTC(2020, 5, 15, 3, 0, 0)); // KST 2020-06-15 정오
    const bucket = '2020-06-15';
    await rollback(async (tx) => {
      const service = new SalesOrdersService(
        { db: tx } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      const pointOf = async () => (await service.getDailyStatusStats(bucket, bucket)).series[0];
      const before = await pointOf();

      const w = await f.seedWorld(tx);
      await phaseOf(tx, w, 'pending', [], day);
      await phaseOf(tx, w, 'confirmed', [], day); // preparing
      await phaseOf(tx, w, 'confirmed', ['shipped', 'draft'], day); // shipping
      await phaseOf(tx, w, 'confirmed', ['delivered'], day); // delivered
      await phaseOf(tx, w, 'shipped', [], day); // externalShipped
      await phaseOf(tx, w, 'delivered', ['draft'], day); // externalShipped (core 상자가 있어도)
      await phaseOf(tx, w, 'cancelled', ['shipped'], day); // cancelled

      const after = await pointOf();
      const delta = (
        k: 'pending' | 'preparing' | 'shipping' | 'delivered' | 'externalShipped' | 'cancelled' | 'total',
      ) => after[k] - before[k];
      expect(delta('pending')).toBe(1);
      expect(delta('preparing')).toBe(1);
      expect(delta('shipping')).toBe(1);
      expect(delta('delivered')).toBe(1);
      expect(delta('externalShipped')).toBe(2);
      expect(delta('cancelled')).toBe(1);
      expect(delta('total')).toBe(7);
    });
  });
});
