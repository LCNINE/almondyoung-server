import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { BadRequestError, ConflictError } from '@app/shared';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import {
  makeDb,
  inRollbackTx,
  seedWarehouseWithZone,
  seedHolder,
  seedSku,
} from '../../../fulfillment/services/__support__';
import { rackBinLocationCode } from '../location-code';
import { LocationService } from './location.service';
import { findLocationIdsInUse } from './rack-bin-sync';

/**
 * 랙 끝 번호 수정이 칸을 따라 맞추는지(#1235). 줄이기는 «사용 중» 칸을 남긴다 — 사용 중은
 * locations.id 를 가리키는 모든 외래키(카탈로그)로 판정한다. SET NULL 외래키(stock_events 등)는
 * 지워 보면 막지 않고 이력의 위치를 NULL 로 만들기 때문에 «지워 보고 막히면 남기기»를 쓰지 않는다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'rack-bin-sync\.integration\.spec\.ts$'
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

function buildService(db: PostgresJsDatabase<typeof wmsSchema>, trx: DbTx): LocationService {
  const dbService = {
    db,
    run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
  } as unknown as DbService<typeof wmsSchema>;
  return new LocationService(dbService);
}

type SeededRack = { rackId: string; byBin: Map<string, string> };

async function seedRack(
  trx: DbTx,
  warehouseId: string,
  opts: { column: string; rack: number; bins: string[]; auto: boolean; start?: number; end: number },
): Promise<SeededRack> {
  const [column] = await trx
    .insert(wmsTables.locationColumns)
    .values({ warehouseId, columnName: opts.column })
    .returning();
  const [rack] = await trx
    .insert(wmsTables.locationRacks)
    .values({
      columnId: column.id,
      rackNumber: opts.rack,
      defaultBinStart: opts.start ?? 1,
      defaultBinEnd: opts.end,
      autoGenerateBins: opts.auto,
    })
    .returning();
  const byBin = new Map<string, string>();
  for (const bin of opts.bins) {
    const code = rackBinLocationCode(opts.column, opts.rack, bin);
    const [loc] = await trx
      .insert(wmsTables.locations)
      .values({
        warehouseId,
        code,
        locationType: 'standard',
        rackId: rack.id,
        binIdentifier: bin,
        displayName: code,
      })
      .returning();
    byBin.set(bin, loc.id);
  }
  return { rackId: rack.id, byBin };
}

async function rackCodes(trx: DbTx, rackId: string): Promise<string[]> {
  const rows = await trx
    .select({ code: wmsTables.locations.code })
    .from(wmsTables.locations)
    .where(eq(wmsTables.locations.rackId, rackId));
  return rows.map((r) => r.code).sort();
}

describeIfDb('syncRackBins · PUT /racks/:rackId (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  it('늘리면 빠진 칸이 생긴다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { warehouseId } = await seedWarehouseWithZone(trx);
      const { rackId } = await seedRack(trx, warehouseId, { column: 'A', rack: 1, bins: ['01', '03'], auto: true, end: 3 });

      const result = await buildService(db, trx).updateRack(rackId, { defaultBinEnd: 5 }, trx);

      expect(result.binChanges).toEqual({ created: ['A-01-02', 'A-01-04', 'A-01-05'], deleted: [], keptInUse: [] });
      expect(result.defaultBinEnd).toBe(5);
      expect(await rackCodes(trx, rackId)).toEqual(['A-01-01', 'A-01-02', 'A-01-03', 'A-01-04', 'A-01-05']);
    });
  });

  it('줄이면 안 쓰는 칸만 지우고, 이력·원장이 가리키는 칸은 남긴다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { warehouseId } = await seedWarehouseWithZone(trx);
      const { rackId, byBin } = await seedRack(trx, warehouseId, {
        column: 'A',
        rack: 1,
        bins: ['01', '02', '03', '04', '05'],
        auto: true,
        end: 5,
      });
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const [event] = await trx
        .insert(wmsTables.stockEvents)
        .values({
          skuId,
          toWarehouseId: warehouseId,
          toLocationId: byBin.get('03'),
          toState: 'ON_HAND',
          transitionType: 'RECEIVE',
          quantity: 1,
          occurredAt: new Date(),
          reason: 'it-1235',
        })
        .returning();
      await trx
        .insert(wmsTables.stockLedgers)
        .values({ skuId, warehouseId, locationId: byBin.get('04') as string, stockState: 'ON_HAND', qty: 0 });

      const result = await buildService(db, trx).updateRack(rackId, { defaultBinEnd: 1 }, trx);

      expect(result.binChanges).toEqual({
        created: [],
        deleted: ['A-01-02', 'A-01-05'],
        keptInUse: ['A-01-03', 'A-01-04'],
      });
      expect(await rackCodes(trx, rackId)).toEqual(['A-01-01', 'A-01-03', 'A-01-04']);
      const [after] = await trx
        .select({ toLocationId: wmsTables.stockEvents.toLocationId })
        .from(wmsTables.stockEvents)
        .where(eq(wmsTables.stockEvents.id, event.id));
      expect(after.toLocationId).toBe(byBin.get('03'));
    });
  });

  it('커스텀 칸은 건드리지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { warehouseId } = await seedWarehouseWithZone(trx);
      const { rackId } = await seedRack(trx, warehouseId, { column: 'M', rack: 7, bins: ['01', '꼭대기'], auto: true, end: 1 });

      const result = await buildService(db, trx).updateRack(rackId, { defaultBinStart: 1, defaultBinEnd: 1 }, trx);

      expect(result.binChanges).toEqual({ created: [], deleted: [], keptInUse: [] });
      expect(await rackCodes(trx, rackId)).toEqual(['M-07-01', 'M-07-꼭대기']);
    });
  });

  it('칸과 무관한 필드(메모)만 바꾸면 칸을 맞추지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { warehouseId } = await seedWarehouseWithZone(trx);
      // 25 는 addCustomBin 으로 단 숫자 커스텀 칸 — 범위(1..3) 밖이지만 메모 수정이 지우면 안 된다.
      const { rackId } = await seedRack(trx, warehouseId, { column: 'A', rack: 1, bins: ['01', '02', '03', '25'], auto: true, end: 3 });

      const result = await buildService(db, trx).updateRack(rackId, { notes: '메모' }, trx);

      expect(result.binChanges).toEqual({ created: [], deleted: [], keptInUse: [] });
      expect(result.notes).toBe('메모');
      expect(await rackCodes(trx, rackId)).toEqual(['A-01-01', 'A-01-02', 'A-01-03', 'A-01-25']);
    });
  });

  it('start > end 면 400 이고 아무것도 안 바뀐다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { warehouseId } = await seedWarehouseWithZone(trx);
      const { rackId } = await seedRack(trx, warehouseId, { column: 'A', rack: 1, bins: ['01', '02', '03'], auto: true, end: 3 });

      const error = await buildService(db, trx)
        .updateRack(rackId, { defaultBinStart: 4 }, trx)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestError);
      expect(await rackCodes(trx, rackId)).toEqual(['A-01-01', 'A-01-02', 'A-01-03']);
      const [rack] = await trx
        .select({ start: wmsTables.locationRacks.defaultBinStart })
        .from(wmsTables.locationRacks)
        .where(eq(wmsTables.locationRacks.id, rackId));
      expect(rack.start).toBe(1);
    });
  });

  it('autoGenerateBins=false 로 줄이면 칸을 지우지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { warehouseId } = await seedWarehouseWithZone(trx);
      const { rackId } = await seedRack(trx, warehouseId, { column: 'A', rack: 1, bins: ['01', '02', '03'], auto: true, end: 3 });

      const result = await buildService(db, trx).updateRack(rackId, { autoGenerateBins: false, defaultBinEnd: 1 }, trx);

      expect(result.binChanges).toEqual({ created: [], deleted: [], keptInUse: [] });
      expect(await rackCodes(trx, rackId)).toEqual(['A-01-01', 'A-01-02', 'A-01-03']);
    });
  });

  it('만들 칸 코드가 다른 곳(zone)에 이미 있으면 409 이고 아무것도 안 만든다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { warehouseId } = await seedWarehouseWithZone(trx);
      const { rackId } = await seedRack(trx, warehouseId, { column: 'B', rack: 1, bins: ['01'], auto: true, end: 1 });
      await trx.insert(wmsTables.locations).values({ warehouseId, code: 'B-01-02', locationType: 'zone' });

      const error = await buildService(db, trx)
        .updateRack(rackId, { defaultBinEnd: 2 }, trx)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictError);
      expect(await rackCodes(trx, rackId)).toEqual(['B-01-01']);
    });
  });

  it('findLocationIdsInUse 는 카탈로그의 모든 외래키를 본다 (skus.primary_location_id)', async () => {
    await inRollbackTx(db, async (trx) => {
      const { warehouseId } = await seedWarehouseWithZone(trx);
      const { byBin } = await seedRack(trx, warehouseId, { column: 'A', rack: 1, bins: ['01', '02'], auto: true, end: 2 });
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      await trx
        .update(wmsTables.skus)
        .set({ primaryLocationId: byBin.get('01') })
        .where(and(eq(wmsTables.skus.id, skuId)));

      const inUse = await findLocationIdsInUse(trx, [byBin.get('01') as string, byBin.get('02') as string]);

      expect([...inUse]).toEqual([byBin.get('01')]);
    });
  });
});
