import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx, seedHolder, seedSku } from '../../../fulfillment/services/__support__';
import { CompleteFieldCaptureInput, SkuFieldCaptureManager } from './sku-field-capture.manager';

/**
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'sku-field-capture\.manager\.integration\.spec\.ts$'
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const actor = { workerId: randomUUID(), workerLabel: 'w1' };
const input: CompleteFieldCaptureInput = {
  packageWidthMm: 120,
  packageLengthMm: 45,
  packageHeightMm: 30,
  packageWeightG: 250,
  barcodeStatus: 'no_manufacturer',
  allFacesConfirmed: true,
};

describeIfDb('SkuFieldCaptureManager (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  function build(trx: DbTx): SkuFieldCaptureManager {
    const dbService = {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
    return new SkuFieldCaptureManager(dbService);
  }

  async function seed(trx: DbTx): Promise<string> {
    const { holderId } = await seedHolder(trx);
    return (await seedSku(trx, holderId)).skuId;
  }

  async function attach(m: SkuFieldCaptureManager, skuId: string, n: number, trx: DbTx): Promise<void> {
    for (let i = 0; i < n; i++) await m.attachPhoto(skuId, randomUUID(), actor, trx);
  }

  const captures = (trx: DbTx, skuId: string) =>
    trx.select().from(wmsTables.skuFieldCaptures).where(eq(wmsTables.skuFieldCaptures.skuId, skuId));

  it('attachPhoto 의 sortOrder 는 max+1', async () => {
    await inRollbackTx(db, async (trx) => {
      const m = build(trx);
      const skuId = await seed(trx);
      await attach(m, skuId, 3, trx);
      const rows = await trx
        .select()
        .from(wmsTables.skuReferencePhotos)
        .where(eq(wmsTables.skuReferencePhotos.skuId, skuId));
      expect(rows.map((r) => r.sortOrder).sort()).toEqual([0, 1, 2]);
    });
  });

  it('complete 는 연결된 사진이 3장 미만이면 BadRequestError', async () => {
    await inRollbackTx(db, async (trx) => {
      const m = build(trx);
      const skuId = await seed(trx);
      await attach(m, skuId, 2, trx);
      await expect(m.complete(skuId, input, actor, trx)).rejects.toBeInstanceOf(BadRequestError);
      expect(await captures(trx, skuId)).toHaveLength(0);
    });
  });

  it('complete 는 skus 의 mm 칸·완료 기록·이벤트를 한 번에 남긴다', async () => {
    await inRollbackTx(db, async (trx) => {
      const m = build(trx);
      const skuId = await seed(trx);
      await attach(m, skuId, 3, trx);
      await m.complete(skuId, input, actor, trx);
      const [sku] = await trx.select().from(wmsTables.skus).where(eq(wmsTables.skus.id, skuId));
      expect([sku.packageWidthMm, sku.packageLengthMm, sku.packageHeightMm]).toEqual([120, 45, 30]);
      expect(sku.packageWeightG).toBe(250);
      const [cap] = await captures(trx, skuId);
      expect(cap.barcodeStatus).toBe('no_manufacturer');
      expect(cap.lastWorkerLabel).toBe('w1');
      const events = await trx
        .select()
        .from(wmsTables.skuFieldCaptureEvents)
        .where(eq(wmsTables.skuFieldCaptureEvents.skuId, skuId));
      expect(events).toHaveLength(1);
    });
  });

  it('scanned 바코드를 보조 바코드로 붙인다', async () => {
    await inRollbackTx(db, async (trx) => {
      const m = build(trx);
      const skuId = await seed(trx);
      await attach(m, skuId, 3, trx);
      await m.complete(skuId, { ...input, barcodeStatus: 'scanned', scannedBarcode: '8809692351771' }, actor, trx);
      const [bc] = await trx
        .select()
        .from(wmsTables.skuBarcodes)
        .where(eq(wmsTables.skuBarcodes.barcode, '8809692351771'));
      expect(bc).toMatchObject({ skuId, barcode: '8809692351771', isPrimary: false, packingUnit: null });
      expect((await captures(trx, skuId))[0].barcodeConflictSkuId).toBeNull();
    });
  });

  it('다른 SKU 가 가진 바코드는 붙이지 않고 conflict 로 남긴다', async () => {
    await inRollbackTx(db, async (trx) => {
      const m = build(trx);
      const a = await seed(trx);
      const b = await seed(trx);
      await trx.insert(wmsTables.skuBarcodes).values({ skuId: b, barcode: '8809692351772' });
      await attach(m, a, 3, trx);
      await m.complete(a, { ...input, barcodeStatus: 'scanned', scannedBarcode: '8809692351772' }, actor, trx);
      const [bc] = await trx
        .select()
        .from(wmsTables.skuBarcodes)
        .where(eq(wmsTables.skuBarcodes.barcode, '8809692351772'));
      expect(bc.skuId).toBe(b);
      expect((await captures(trx, a))[0].barcodeConflictSkuId).toBe(b);
    });
  });

  it('이미 이 SKU 에 있는 바코드는 그대로 둔다', async () => {
    await inRollbackTx(db, async (trx) => {
      const m = build(trx);
      const skuId = await seed(trx);
      await attach(m, skuId, 3, trx);
      const scanned = { ...input, barcodeStatus: 'scanned' as const, scannedBarcode: '8809692351773' };
      await m.complete(skuId, scanned, actor, trx);
      // 한 트랜잭션 안에선 now() 가 같아 불변식이 검증되지 않는다 — 과거로 밀어 두고 본다.
      await trx
        .update(wmsTables.skuFieldCaptures)
        .set({ firstCompletedAt: sql`now() - interval '1 day'`, lastCompletedAt: sql`now() - interval '1 day'` })
        .where(eq(wmsTables.skuFieldCaptures.skuId, skuId));
      const [first] = await captures(trx, skuId);
      await m.complete(skuId, scanned, actor, trx);
      const bcs = await trx
        .select()
        .from(wmsTables.skuBarcodes)
        .where(eq(wmsTables.skuBarcodes.barcode, '8809692351773'));
      expect(bcs).toHaveLength(1);
      const events = await trx
        .select()
        .from(wmsTables.skuFieldCaptureEvents)
        .where(eq(wmsTables.skuFieldCaptureEvents.skuId, skuId));
      expect(events).toHaveLength(2);
      const [second] = await captures(trx, skuId);
      expect(second.barcodeConflictSkuId).toBeNull();
      expect(second.firstCompletedAt).toEqual(first.firstCompletedAt);
      expect(second.lastCompletedAt.getTime()).toBeGreaterThan(first.lastCompletedAt.getTime());
    });
  });

  it('scanned 인데 scannedBarcode 가 비면 BadRequestError', async () => {
    await inRollbackTx(db, async (trx) => {
      const m = build(trx);
      const skuId = await seed(trx);
      await attach(m, skuId, 3, trx);
      await expect(m.complete(skuId, { ...input, barcodeStatus: 'scanned' }, actor, trx)).rejects.toBeInstanceOf(
        BadRequestError,
      );
    });
  });

  it('없는 SKU 는 NotFoundError', async () => {
    await inRollbackTx(db, async (trx) => {
      const m = build(trx);
      await expect(m.attachPhoto(randomUUID(), randomUUID(), actor, trx)).rejects.toBeInstanceOf(NotFoundError);
      await expect(m.complete(randomUUID(), input, actor, trx)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it('removePhoto 는 그 SKU 의 사진만 지운다', async () => {
    await inRollbackTx(db, async (trx) => {
      const m = build(trx);
      const a = await seed(trx);
      const b = await seed(trx);
      const photo = await m.attachPhoto(a, randomUUID(), actor, trx);
      await expect(m.removePhoto(b, photo.id, trx)).rejects.toBeInstanceOf(NotFoundError);
      await m.removePhoto(a, photo.id, trx);
      const rows = await trx
        .select()
        .from(wmsTables.skuReferencePhotos)
        .where(eq(wmsTables.skuReferencePhotos.skuId, a));
      expect(rows).toHaveLength(0);
    });
  });
});
