import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { NotFoundError } from '@app/shared';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import {
  makeDb,
  makeDbService,
  wireLogistics,
  inRollbackTx,
  Wired,
  seedWarehouseWithZone,
  seedHolder,
  seedSku,
  receiveStock,
} from '../../../fulfillment/services/__support__';
import { CompleteFieldCaptureInput, SkuFieldCaptureManager } from './sku-field-capture.manager';
import { SkuFieldCaptureReader } from './sku-field-capture.reader';

/**
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'sku-field-capture\.reader\.integration\.spec\.ts$'
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const w1 = { workerId: randomUUID(), workerLabel: 'w1' };
const w2 = { workerId: randomUUID(), workerLabel: 'w2' };
const input: CompleteFieldCaptureInput = {
  packageWidthMm: 120,
  packageLengthMm: 45,
  packageHeightMm: 30,
  barcodeStatus: 'no_manufacturer',
  allFacesConfirmed: true,
};

describeIfDb('SkuFieldCaptureReader (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let wired: Wired;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    wired = wireLogistics(makeDbService(db));
  });
  afterAll(async () => {
    await client.end();
  });

  function build(trx: DbTx) {
    const dbService = {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
    return { reader: new SkuFieldCaptureReader(dbService), manager: new SkuFieldCaptureManager(dbService) };
  }

  async function seed(trx: DbTx): Promise<string> {
    const { holderId } = await seedHolder(trx);
    return (await seedSku(trx, holderId)).skuId;
  }

  async function complete(
    m: SkuFieldCaptureManager,
    skuId: string,
    trx: DbTx,
    actor = w1,
    over: Partial<CompleteFieldCaptureInput> = {},
  ): Promise<void> {
    const have = await trx
      .select({ id: wmsTables.skuReferencePhotos.id })
      .from(wmsTables.skuReferencePhotos)
      .where(eq(wmsTables.skuReferencePhotos.skuId, skuId));
    for (let i = have.length; i < 3; i++) await m.attachPhoto(skuId, randomUUID(), actor, trx);
    await m.complete(skuId, { ...input, ...over }, actor, trx);
  }

  it('소문자·공백 섞인 코드로도 찾는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { reader, manager } = build(trx);
      const a = await seed(trx);
      const b = await seed(trx);
      await trx.insert(wmsTables.skuShelfPositions).values([
        { skuId: a, positionCode: 'T-01-20' },
        { skuId: b, positionCode: 'T-01-20' },
      ]);
      const before = await reader.findByPosition(' t-01-20 ', trx);
      expect(before.positionCode).toBe('T-01-20');
      expect(before.skus.map((s) => s.skuId).sort()).toEqual([a, b].sort());
      expect(before.skus.every((s) => s.completion === null)).toBe(true);
      await complete(manager, a, trx);
      const after = await reader.findByPosition(' t-01-20 ', trx);
      const row = after.skus.find((s) => s.skuId === a);
      expect(row?.completion?.lastWorkerLabel).toBe('w1');
      expect(row?.completion?.barcodeStatus).toBe('no_manufacturer');
    });
  });

  it('삭제된 SKU 는 선반 조회에서 빠진다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { reader } = build(trx);
      const a = await seed(trx);
      await trx.insert(wmsTables.skuShelfPositions).values({ skuId: a, positionCode: 'T-01-21' });
      await trx.update(wmsTables.skus).set({ isDeleted: true }).where(eq(wmsTables.skus.id, a));
      expect((await reader.findByPosition('T-01-21', trx)).skus).toEqual([]);
    });
  });

  it('등록 안 된 위치는 빈 목록', async () => {
    await inRollbackTx(db, async (trx) => {
      const { reader } = build(trx);
      expect(await reader.findByPosition('ZZ-99-99', trx)).toEqual({ positionCode: 'ZZ-99-99', skus: [] });
    });
  });

  it('상세는 사진 순서·바코드·충돌 SKU 를 담는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { reader, manager } = build(trx);
      const a = await seed(trx);
      const b = await seed(trx);
      await trx.insert(wmsTables.skuBarcodes).values({ skuId: b, barcode: '8809692359001' });
      const files = [randomUUID(), randomUUID(), randomUUID()];
      for (const f of files) await manager.attachPhoto(a, f, w1, trx);
      await manager.complete(a, { ...input, barcodeStatus: 'scanned', scannedBarcode: '8809692359001' }, w1, trx);
      const d = await reader.getDetail(a, trx);
      expect(d.photos.map((p) => p.fileId)).toEqual(files);
      expect(d.photos.map((p) => p.sortOrder)).toEqual([0, 1, 2]);
      expect([d.packageWidthMm, d.packageLengthMm, d.packageHeightMm]).toEqual([120, 45, 30]);
      expect(d.completion?.scannedBarcode).toBe('8809692359001');
      expect(d.completion?.barcodeConflict?.skuId).toBe(b);
      expect(d.completion?.allFacesConfirmed).toBe(true);
      expect(d.barcodes).toEqual([]);
      const other = await reader.getDetail(b, trx);
      expect(other.barcodes).toEqual(['8809692359001']);
      expect(other.completion).toBeNull();
      await expect(reader.getDetail(randomUUID(), trx)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it('findBarcodeOwner 는 없으면 null', async () => {
    await inRollbackTx(db, async (trx) => {
      const { reader } = build(trx);
      const a = await seed(trx);
      await trx.insert(wmsTables.skuBarcodes).values({ skuId: a, barcode: '8809692359002' });
      expect((await reader.findBarcodeOwner(' 8809692359002 ', trx))?.skuId).toBe(a);
      expect(await reader.findBarcodeOwner('0000000000000', trx)).toBeNull();
    });
  });

  it('남은 SKU 는 ON_HAND 재고가 있는 미완료 SKU 만 센다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { reader, manager } = build(trx);
      const before = await reader.getProgress(trx);
      const wh = await seedWarehouseWithZone(trx);
      const stocked = await seed(trx);
      const stockedDone = await seed(trx);
      const noStock = await seed(trx);
      for (const skuId of [stocked, stockedDone]) {
        await receiveStock(wired.command, trx, { skuId, ...wh, quantity: 5 });
      }
      await complete(manager, stockedDone, trx);
      void noStock;
      const after = await reader.getProgress(trx);
      expect(after.remainingSkus - before.remainingSkus).toBe(1);
      expect(after.completedSkus - before.completedSkus).toBe(1);
    });
  });

  it('재작업이 앞 작업자의 누적을 지우지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { reader, manager } = build(trx);
      const a = await seed(trx);
      const before = await reader.getProgress(trx);
      await complete(manager, a, trx, w1);
      await complete(manager, a, trx, w2);
      const after = await reader.getProgress(trx);
      const pick = (p: typeof after, id: string) => p.workers.find((x) => x.workerId === id);
      expect(pick(after, w1.workerId)?.total).toBe((pick(before, w1.workerId)?.total ?? 0) + 1);
      expect(pick(after, w2.workerId)?.total).toBe((pick(before, w2.workerId)?.total ?? 0) + 1);
      expect(pick(after, w1.workerId)?.workerLabel).toBe('w1');
      expect(pick(after, w1.workerId)?.today).toBe((pick(before, w1.workerId)?.today ?? 0) + 1);
      expect(after.completedSkus - before.completedSkus).toBe(1);
    });
  });

  it('스티커 필요는 barcodeStatus none 인 완료 SKU 수', async () => {
    await inRollbackTx(db, async (trx) => {
      const { reader, manager } = build(trx);
      const a = await seed(trx);
      const b = await seed(trx);
      const c = await seed(trx);
      const conflictOwner = await seed(trx);
      await trx.insert(wmsTables.skuBarcodes).values({ skuId: conflictOwner, barcode: '8809692359003' });
      const before = await reader.getProgress(trx);
      await complete(manager, a, trx, w1, { barcodeStatus: 'none' });
      await complete(manager, b, trx, w1, { barcodeStatus: 'no_manufacturer' });
      await complete(manager, c, trx, w1, { barcodeStatus: 'scanned', scannedBarcode: '8809692359003' });
      const after = await reader.getProgress(trx);
      expect(after.stickerNeededSkus - before.stickerNeededSkus).toBe(1);
      expect(after.barcodeConflictSkus - before.barcodeConflictSkus).toBe(1);
    });
  });

  it('countWorkerToday 는 그 작업자가 오늘 완료한 SKU 를 중복 없이 센다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { reader, manager } = build(trx);
      const a = await seed(trx);
      const b = await seed(trx);
      const c = await seed(trx);
      const me = { workerId: randomUUID(), workerLabel: 'me' };
      const other = { workerId: randomUUID(), workerLabel: 'other' };
      await complete(manager, a, trx, me);
      await complete(manager, a, trx, me);
      await complete(manager, b, trx, me);
      await complete(manager, c, trx, other);
      expect(await reader.countWorkerToday(me.workerId, trx)).toBe(2);
      expect(await reader.countWorkerToday(other.workerId, trx)).toBe(1);
    });
  });

  it('countWorkerToday 는 어제 완료는 세지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { reader, manager } = build(trx);
      const a = await seed(trx);
      const me = { workerId: randomUUID(), workerLabel: 'me' };
      await complete(manager, a, trx, me);
      await trx
        .update(wmsTables.skuFieldCaptureEvents)
        .set({ completedAt: sql`now() - interval '1 day'` })
        .where(eq(wmsTables.skuFieldCaptureEvents.workerId, me.workerId));
      expect(await reader.countWorkerToday(me.workerId, trx)).toBe(0);
    });
  });
});
