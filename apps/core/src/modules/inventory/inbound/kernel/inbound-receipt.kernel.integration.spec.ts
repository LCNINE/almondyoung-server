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

  let probe: postgres.Sql;
  beforeAll(() => {
    probe = postgres(DATABASE_URL as string, { max: 1 });
  });
  afterAll(async () => {
    await probe.end();
  });

  class Rollback extends Error {}

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

  /** 커밋된 창고·SKU·로케이션·간편입고 5개. 잠금 스펙 전용 — 행이 남는다. */
  async function seedCommittedLine() {
    const suffix = randomUUID();
    return db.transaction(async (trx) => {
      const tx = trx as unknown as DbTx;
      const { warehouseId, skuId } = await seedWarehouseAndSku(tx, suffix);
      const [shelf] = await tx
        .insert(wmsTables.locations)
        .values({
          warehouseId,
          code: `KL-${suffix.slice(0, 6)}`,
          locationType: 'zone',
          isSystem: false,
          systemRole: null,
          isActive: true,
        })
        .returning();
      const { lines } = await kernel.recordArrival(
        {
          source: 'direct',
          method: 'simple',
          warehouseId,
          reason: 'kernel_lock_spec',
          lines: [{ skuId, quantity: 5, eventKey: `kernel-lock-spec:${suffix}` }],
        },
        tx,
      );
      return { lineId: lines[0]?.id ?? '', shelfId: shelf.id };
    });
  }

  /**
   * `hold` 를 연 트랜잭션 안에서 실행해 둔 채로, 다른 커넥션이 같은 회차 라인을 NOWAIT 로 잠가 본다.
   * 탐침은 `FOR UPDATE` 가 아니라 `FOR KEY SHARE` 를 쓴다 — `hold` 트랜잭션은 명시적 잠금 말고도
   * `canceled_qty` UPDATE(FOR NO KEY UPDATE 암묵 락)와 라인을 FK 로 참조하는 작업 로그 INSERT
   * (FOR KEY SHARE 암묵 락)를 하므로, `FOR UPDATE NOWAIT` 탐침은 `.for('update')` 유무와 무관하게
   * 항상 55P03 이 나서 판별력이 없다. `FOR KEY SHARE` 는 `FOR UPDATE` 하고만 충돌하므로, 55P03 이면
   * 그건 오직 `cancelLine` 이 명시적으로 잡은 행 잠금 탓이다. 끝나면 롤백한다.
   */
  async function expectLineLockedDuring(lineId: string, hold: (tx: DbTx) => Promise<unknown>) {
    let entered: () => void = () => undefined;
    const enteredSignal = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release: () => void = () => undefined;
    const releaseSignal = new Promise<void>((resolve) => {
      release = resolve;
    });

    const held = db.transaction(async (trx) => {
      await hold(trx as unknown as DbTx);
      entered();
      await releaseSignal;
      throw new Rollback('intentional rollback');
    });

    // hold 가 먼저 실패하면 신호를 기다리지 말고 바로 드러낸다.
    await Promise.race([enteredSignal, held]);
    try {
      await expect(
        probe`SELECT id FROM inbound_receipt_lines WHERE id = ${lineId} FOR KEY SHARE NOWAIT`,
      ).rejects.toMatchObject({
        code: '55P03',
      });
    } finally {
      // 탐침 단언이 실패해도(=잠그지 않음) hold 를 반드시 풀어준다 — 안 풀면 잡고 있던 커넥션이
      // 다음 훅까지 안 끝나 러너가 상한 시간까지 멎는다(잠금 없는 뮤테이션에서 실측: 121s 타임아웃).
      release();
      await held.catch(() => undefined);
    }
    await expect(held).rejects.toThrow(Rollback);
  }

  describe('회차 라인 잠금 (스펙 §7.1)', () => {
    it('cancelLine 은 회차 라인을 FOR UPDATE 로 잠근다', async () => {
      const { lineId } = await seedCommittedLine();
      await expectLineLockedDuring(lineId, (tx) => kernel.cancelLine({ receiptLineId: lineId }, tx));
    });

    it('putaway 는 회차 라인을 FOR UPDATE 로 잠근다', async () => {
      const { lineId, shelfId } = await seedCommittedLine();
      await expectLineLockedDuring(lineId, (tx) =>
        kernel.putaway(
          {
            receiptLineId: lineId,
            toLocationId: shelfId,
            quantity: 1,
            eventKey: `kernel-lock-spec:putaway:${randomUUID()}`,
          },
          tx,
        ),
      );
    });

    it('returnLine 은 회차 라인을 FOR UPDATE 로 잠근다', async () => {
      const { lineId } = await seedCommittedLine();
      await expectLineLockedDuring(lineId, (tx) =>
        kernel.returnLine(
          { receiptLineId: lineId, quantity: 1, eventKey: `kernel-lock-spec:return:${randomUUID()}` },
          tx,
        ),
      );
    });
  });
});
