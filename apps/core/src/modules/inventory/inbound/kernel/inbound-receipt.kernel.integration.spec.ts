import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { InboundReceiptKernel } from './inbound-receipt.kernel';
import { Database, inRollbackTx, makeInboundReceiptKernel } from '../services/__fixtures__/inbound-harness';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * 입고 커널의 계약. 동작 세부(이벤트·작업 로그 모양)는 InboundService 기준선 스펙이 고정한다 —
 * 여기서는 커널만의 약속을 본다: 호출자 트랜잭션 안에서만 쓴다 · eventKey 를 그대로 쓴다 ·
 * 회차 라인 행을 잠근다(Task 5·6).
 *
 *   npm run test:core:integration:local -- inbound-receipt.kernel
 */
describeIfDb('InboundReceiptKernel (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: Database;
  let kernel: InboundReceiptKernel;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
    kernel = makeInboundReceiptKernel(db);
  });

  afterAll(async () => {
    await client.end();
  });

  async function seedWarehouseAndSku(tx: DbTx, suffix: string) {
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `kernel-wh-${suffix.slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `kernel-holder-${suffix.slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'kernel sku', code: `KERNEL-${suffix}`, holderId: holder.id })
      .returning();
    return { warehouseId: warehouse.id, skuId: sku.id };
  }

  describe('recordArrival', () => {
    it('합계를 반영한 회차와 source 를 든 라인을 돌려주고, 라인별 eventKey 를 그대로 쓴다', async () => {
      await inRollbackTx(db, async (tx) => {
        const suffix = randomUUID();
        const { warehouseId, skuId } = await seedWarehouseAndSku(tx, suffix);

        const result = await kernel.recordArrival(
          {
            source: 'direct',
            method: 'simple',
            warehouseId,
            reason: 'kernel_spec',
            lines: [
              { skuId, quantity: 2, eventKey: `kernel-spec:${suffix}:a` },
              { skuId, quantity: 5, memo: 'm', eventKey: `kernel-spec:${suffix}:b` },
            ],
          },
          tx,
        );

        expect(result.receipt).toMatchObject({ method: 'simple', warehouseId, status: 'posted', totalQuantity: 7 });
        expect(result.lines.map((l) => [l.quantity, l.source, l.memo])).toEqual([
          [2, 'direct', null],
          [5, 'direct', 'm'],
        ]);
        const keys = await tx
          .select({ key: wmsTables.stockEvents.idempotencyKey, id: wmsTables.stockEvents.id })
          .from(wmsTables.stockEvents)
          .where(eq(wmsTables.stockEvents.journalId, result.receipt.journalId ?? ''));
        expect(keys.map((k) => k.key).sort()).toEqual([`kernel-spec:${suffix}:a`, `kernel-spec:${suffix}:b`]);
      });
    });

    it('지정 로케이션을 그대로 쓴다', async () => {
      await inRollbackTx(db, async (tx) => {
        const suffix = randomUUID();
        const { warehouseId, skuId } = await seedWarehouseAndSku(tx, suffix);
        const [shelf] = await tx
          .insert(wmsTables.locations)
          .values({
            warehouseId,
            code: `K-${suffix.slice(0, 6)}`,
            locationType: 'zone',
            isSystem: false,
            systemRole: null,
            isActive: true,
          })
          .returning();

        const result = await kernel.recordArrival(
          {
            source: 'direct',
            method: 'individual',
            warehouseId,
            locationId: shelf.id,
            reason: 'kernel_spec',
            lines: [{ skuId, quantity: 1, eventKey: `kernel-spec:${suffix}` }],
          },
          tx,
        );

        expect(result.receipt.locationId).toBe(shelf.id);
        expect(result.lines[0]?.originLocationId).toBe(shelf.id);
      });
    });

    it('호출자 트랜잭션 밖으로 쓰기가 새지 않는다 — 롤백하면 회차가 남지 않는다', async () => {
      const suffix = randomUUID();
      let warehouseId = '';
      await inRollbackTx(db, async (tx) => {
        const seeded = await seedWarehouseAndSku(tx, suffix);
        warehouseId = seeded.warehouseId;
        await kernel.recordArrival(
          {
            source: 'direct',
            method: 'simple',
            warehouseId,
            reason: 'kernel_spec',
            lines: [{ skuId: seeded.skuId, quantity: 1, eventKey: `kernel-spec:${suffix}` }],
          },
          tx,
        );
      });

      const leaked = await db
        .select({ id: wmsTables.inboundReceipts.id })
        .from(wmsTables.inboundReceipts)
        .where(eq(wmsTables.inboundReceipts.warehouseId, warehouseId));
      expect(leaked).toEqual([]);
    });
  });
});
