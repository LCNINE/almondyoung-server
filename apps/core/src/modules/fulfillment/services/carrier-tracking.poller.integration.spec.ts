import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { CarrierGatewayRegistry } from '../waybill/carrier/carrier-gateway.registry';
import { makeDbService } from './__support__';
import { CarrierTrackingPoller } from './carrier-tracking.poller';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('CarrierTrackingPoller.findTargets (PostgreSQL integration)', () => {
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

  it('출고된·배송완료 전·창 안·추적 가능 캐리어의 운송장만 오래된 출고부터 고른다', async () => {
    const suffix = randomUUID();
    const since = new Date('2026-09-12T00:00:00.000Z');
    const poller = new CarrierTrackingPoller(
      makeDbService(db),
      new CarrierGatewayRegistry([]),
      {} as never,
      {} as never,
    );

    type Case = {
      key: string;
      shipmentStatus: 'shipped' | 'in_transit' | 'delivered';
      carrier: 'HANJIN' | 'CJ';
      dispatchedAt: Date;
    };
    const cases: Case[] = [
      { key: 'shipped', shipmentStatus: 'shipped', carrier: 'HANJIN', dispatchedAt: new Date('2026-09-24T00:00:00Z') },
      {
        key: 'in-transit',
        shipmentStatus: 'in_transit',
        carrier: 'HANJIN',
        dispatchedAt: new Date('2026-09-20T00:00:00Z'),
      },
      {
        key: 'delivered',
        shipmentStatus: 'delivered',
        carrier: 'HANJIN',
        dispatchedAt: new Date('2026-09-21T00:00:00Z'),
      },
      { key: 'too-old', shipmentStatus: 'shipped', carrier: 'HANJIN', dispatchedAt: new Date('2026-09-11T23:59:59Z') },
      {
        key: 'other-carrier',
        shipmentStatus: 'shipped',
        carrier: 'CJ',
        dispatchedAt: new Date('2026-09-22T00:00:00Z'),
      },
    ];

    let found: Awaited<ReturnType<CarrierTrackingPoller['findTargets']>> = [];
    const attemptKeys = new Map<string, string>();
    await expect(
      db.transaction(async (tx) => {
        const [warehouse] = await tx
          .insert(wmsTables.warehouses)
          .values({ name: `tracking-poll-wh-${suffix}` })
          .returning();
        for (const c of cases) {
          const [shipment] = await tx
            .insert(wmsTables.shipments)
            .values({ warehouseId: warehouse.id, status: c.shipmentStatus, shippedAt: c.dispatchedAt })
            .returning();
          const [waybill] = await tx
            .insert(wmsTables.waybills)
            .values({
              shipmentId: shipment.id,
              source: 'carrier',
              carrier: c.carrier,
              status: 'used',
              trackingNo: `TP-${c.key}-${suffix}`.slice(0, 128),
              manifestVersion: 1,
              recipientHash: 'a'.repeat(64),
            })
            .returning();
          const [journal] = await tx
            .insert(wmsTables.stockJournals)
            .values({ sourceType: 'dispatch', idempotencyKey: `tracking-poll-${c.key}-${suffix}` })
            .returning();
          const [attempt] = await tx
            .insert(wmsTables.dispatchAttempts)
            .values({
              shipmentId: shipment.id,
              attemptNo: 1,
              status: 'dispatched',
              idempotencyKey: `tracking-poll-attempt-${c.key}-${suffix}`,
              waybillId: waybill.id,
              stockJournalId: journal.id,
              dispatchedAt: c.dispatchedAt,
            })
            .returning();
          attemptKeys.set(attempt.id, c.key);
        }

        found = await poller.findTargets(['HANJIN'], since, tx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    const ours = found.filter((t) => attemptKeys.has(t.dispatchAttemptId));
    expect(ours.map((t) => attemptKeys.get(t.dispatchAttemptId))).toEqual(['in-transit', 'shipped']);
    expect(ours[0]).toMatchObject({
      carrier: 'HANJIN',
      trackingNo: `TP-in-transit-${suffix}`,
      dispatchedAt: new Date('2026-09-20T00:00:00Z'),
    });
  });
});
