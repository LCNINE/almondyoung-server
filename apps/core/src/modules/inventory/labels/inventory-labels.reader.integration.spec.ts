import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../schema/inventory.schema';
import {
  makeDb,
  inRollbackTx,
  seedWarehouseWithZone,
  seedHolder,
  seedSku,
} from '../../fulfillment/services/__support__';
import { resolveSkuIdByBarcode } from '../../fulfillment/services/sku-barcode-resolution';
import { BarcodeService } from '../shared/services/barcode.service';
import { SkuCatalogReader } from '../sku-catalog/services/sku-catalog.reader';
import { InventoryLabelsReader } from './inventory-labels.reader';

/**
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'inventory-labels\.reader\.integration\.spec\.ts$'
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('InventoryLabelsReader (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  function dbServiceOf(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  async function seedSkuWithName(trx: DbTx): Promise<string> {
    const { holderId } = await seedHolder(trx);
    return (await seedSku(trx, holderId)).skuId;
  }

  it('대표 바코드를 고르고, 대표가 없으면 가장 이른 행을 고르며, 행이 없으면 null', async () => {
    await inRollbackTx(db, async (trx) => {
      const reader = new InventoryLabelsReader(dbServiceOf(trx));
      const withPrimary = await seedSkuWithName(trx);
      const noPrimary = await seedSkuWithName(trx);
      const none = await seedSkuWithName(trx);
      const tag = randomUUID().slice(0, 8);
      const early = new Date('2026-01-01T00:00:00Z');
      const late = new Date('2026-02-01T00:00:00Z');
      await trx.insert(wmsTables.skuBarcodes).values([
        { skuId: withPrimary, barcode: `NP-${tag}`, isPrimary: false, createdAt: early },
        { skuId: withPrimary, barcode: `PR-${tag}`, isPrimary: true, createdAt: late },
        { skuId: noPrimary, barcode: `L2-${tag}`, isPrimary: false, createdAt: late },
        { skuId: noPrimary, barcode: `E1-${tag}`, isPrimary: false, createdAt: early },
      ]);
      const rows = await reader.skusForLabels([withPrimary, noPrimary, none], trx);
      const byId = new Map(rows.map((r) => [r.id, r.barcode]));
      expect(byId.get(withPrimary)).toBe(`PR-${tag}`);
      expect(byId.get(noPrimary)).toBe(`E1-${tag}`);
      expect(byId.get(none)).toBeNull();
    });
  });

  it('왕복: 고른 바코드로 스캔 해석과 SKU 조회 화면이 같은 SKU 를 찾는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const dbService = dbServiceOf(trx);
      const reader = new InventoryLabelsReader(dbService);
      const skuId = await seedSkuWithName(trx);
      const barcode = `RT-${randomUUID().slice(0, 8)}`;
      await trx.insert(wmsTables.skuBarcodes).values({ skuId, barcode, isPrimary: true });
      const [row] = await reader.skusForLabels([skuId], trx);
      expect(row.barcode).toBe(barcode);
      const printed = row.barcode as string;

      expect(await resolveSkuIdByBarcode(new BarcodeService(dbService), printed, trx)).toBe(skuId);
      const found = await new SkuCatalogReader(dbService).search({ barcode: printed }, trx);
      expect(found.map((s) => s.id)).toEqual([skuId]);
    });
  });

  it('로케이션: 시스템·비활성은 빠지고 코드 오름차순이며, 랙·id 두 입력 모두 된다', async () => {
    await inRollbackTx(db, async (trx) => {
      const reader = new InventoryLabelsReader(dbServiceOf(trx));
      const { warehouseId } = await seedWarehouseWithZone(trx);
      const [column] = await trx.insert(wmsTables.locationColumns).values({ warehouseId, columnName: 'T' }).returning();
      const [rack] = await trx
        .insert(wmsTables.locationRacks)
        .values({ columnId: column.id, rackNumber: 1 })
        .returning();
      const tag = randomUUID().slice(0, 6).toUpperCase();
      const base = { warehouseId, rackId: rack.id, locationType: 'standard' as const };
      const inserted = await trx
        .insert(wmsTables.locations)
        .values([
          { ...base, code: `B-${tag}`, binIdentifier: '2' },
          { ...base, code: `A-${tag}`, binIdentifier: '1' },
          { ...base, code: `X-${tag}`, binIdentifier: '3', isActive: false },
        ])
        .returning();
      // 시스템 로케이션은 랙 밖의 zone 이다(CHECK) — id 로 지목해도 빠져야 한다.
      const [system] = await trx
        .insert(wmsTables.locations)
        .values({
          warehouseId,
          code: `S-${tag}`,
          locationType: 'zone',
          isSystem: true,
          systemRole: 'inbound_default',
        })
        .returning();

      const byRack = await reader.locationsForLabels({ rackId: rack.id }, trx);
      expect(byRack.map((l) => l.code)).toEqual([`A-${tag}`, `B-${tag}`]);

      const byIds = await reader.locationsForLabels({ locationIds: [...inserted, system].map((l) => l.id) }, trx);
      expect(byIds.map((l) => l.code)).toEqual([`A-${tag}`, `B-${tag}`]);
    });
  });
});
