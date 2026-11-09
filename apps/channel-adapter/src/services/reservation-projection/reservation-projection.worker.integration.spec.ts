import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { SalesOrderLineReservationStatePayload } from '@packages/event-contracts/streams/orders.stream';
import { LineReservationStateConsumer } from '../../consumers/line-reservation-state.consumer';
import { channelAdapterSchema, inboxEvents, medusaReservationProjectionVersions } from '../../schema';
import { ReservationProjectionWorker } from './reservation-projection.worker';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');

/**
 * 버전 상향 가드(setWhere)·클레임 SQL·소비자 멱등을 진짜 Postgres 에 대고 본다.
 * 일회용 스키마 + search_path startup 파라미터로 격리한다(선례: inbox-claim-order.integration.spec.ts).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const PAYLOAD: SalesOrderLineReservationStatePayload = {
  salesOrderId: 'so-int',
  salesChannel: 'medusa',
  channelOrderId: 'order_1',
  orderedAt: '2026-11-09T00:00:00.000Z',
  version: 6,
  asOf: '2026-11-09T00:01:00.000Z',
  lines: [],
};

describeIfDb('예약 투영 워커·소비자 (DB 통합)', () => {
  jest.setTimeout(120_000);
  const schemaName = `resv_proj_${randomUUID().replaceAll('-', '')}`;
  let client: postgres.Sql;
  let worker: ReservationProjectionWorker;
  let consumer: LineReservationStateConsumer;
  let db: ReturnType<typeof drizzle<typeof channelAdapterSchema>>;

  beforeAll(async () => {
    const admin = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await admin.end();
    const setup = postgres(DATABASE_URL as string, { max: 1, prepare: false, connection: { search_path: schemaName } });
    await setup.unsafe(`CREATE TABLE inbox_events (LIKE public.inbox_events INCLUDING ALL)`);
    await setup.unsafe(
      `CREATE TABLE medusa_reservation_projection_versions (LIKE public.medusa_reservation_projection_versions INCLUDING ALL)`,
    );
    await setup.end();

    client = postgres(DATABASE_URL as string, { max: 1, prepare: false, connection: { search_path: schemaName } });
    db = drizzle(client, { schema: channelAdapterSchema });
    // 이 스펙이 구동하는 메서드는 협력자를 쓰지 않는다 — 스텁조차 불필요해 never 로 채운다.
    worker = new ReservationProjectionWorker({ db } as never, never(), never(), never());
    consumer = new LineReservationStateConsumer({ db } as never);
  });

  afterAll(async () => {
    await client.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
    await client.end();
  });

  beforeEach(async () => {
    await db.delete(inboxEvents);
    await db.delete(medusaReservationProjectionVersions);
  });

  function never(): never {
    return {} as never;
  }

  it('버전 upsert — v6 뒤에 v5 가 와도 applied_version 은 6 이다', async () => {
    await worker.bumpVersion('so-int', 6);
    await worker.bumpVersion('so-int', 5);
    const [row] = await db
      .select()
      .from(medusaReservationProjectionVersions)
      .where(eq(medusaReservationProjectionVersions.salesOrderId, 'so-int'));
    expect(row.appliedVersion).toBe(6);
    await worker.bumpVersion('so-int', 7);
    const [after] = await db.select().from(medusaReservationProjectionVersions);
    expect(after.appliedVersion).toBe(7);
  });

  it('클레임 — 다른 이벤트 타입은 건드리지 않고, next_attempt_at 전의 deferred 행은 다시 집지 않는다', async () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 10 * 60_000);
    await db.insert(inboxEvents).values([
      { eventType: 'ShipmentShipped', aggregateType: 'Shipment', aggregateId: 'x', partitionKey: 'x', payload: {}, nextAttemptAt: past },
      {
        eventType: 'SalesOrderLineReservationState',
        idempotencyKey: 'so-int:5',
        aggregateType: 'Order',
        aggregateId: 'so-int',
        partitionKey: 'so-int',
        payload: PAYLOAD,
        nextAttemptAt: future,
      },
    ]);
    expect(await worker.claimNext()).toBeNull();

    await db.insert(inboxEvents).values({
      eventType: 'SalesOrderLineReservationState',
      idempotencyKey: 'so-int:6',
      aggregateType: 'Order',
      aggregateId: 'so-int',
      partitionKey: 'so-int',
      payload: PAYLOAD,
      nextAttemptAt: past,
    });
    const claimed = await worker.claimNext();
    expect(claimed?.payload.version).toBe(6);
    expect(claimed?.attempts).toBe(1);
    expect(await worker.claimNext()).toBeNull();
    const shipped = await db.select().from(inboxEvents).where(eq(inboxEvents.eventType, 'ShipmentShipped'));
    expect(shipped[0].status).toBe('pending');
  });

  it('소비자 — 같은 (salesOrderId, version) 두 번이면 행 1개', async () => {
    const envelope = { correlationId: 'c', causationId: 'k', messageId: 'm' } as never; // 소비자가 읽는 필드만
    await consumer.onLineReservationState(PAYLOAD, envelope);
    await consumer.onLineReservationState(PAYLOAD, envelope);
    expect(await db.select().from(inboxEvents)).toHaveLength(1);
  });
});
