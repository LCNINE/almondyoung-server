import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { InboundService } from './inbound.service';
import { Database, inRollbackTx, makeInboundService } from './__fixtures__/inbound-harness';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * 당일 취소 판정이 **서울 달력 날짜**를 보는지 고정한다 (#724 항목 11 / 발견 ⑪).
 *
 * 이 스펙이 존재하는 이유: 판정이 `isSameSeoulDay(nowSeoul(), occurredAt)` 이라 왼쪽에만
 * 오프셋이 두 번 먹었다. 라이브(UTC 프로세스)에서 **KST 15:00~24:00 의 당일 취소가 전부 400** 이었다.
 *
 * ⚠️ **이 스펙은 프로세스가 UTC 로 떴을 때만 의미가 있다.** `toZonedTime` 이 런타임 TZ 에
 * 상대적이라 `Asia/Seoul` 에서는 이중 변환이 항등이 되고, 고치기 전 코드도 통과한다.
 * `scripts/jest/global-setup.js` 가 jest 를 UTC 로 띄우므로(#724 항목 13) 로컬 실행도 유효하다.
 * 스펙 파일 안에서 `process.env.TZ` 를 바꾸는 것은 이미 늦으니 그러지 말 것.
 *
 * 벽시계는 가짜 타이머로 못 박는다 — 판정이 `new Date()` 를 쓰므로 실행 시각이 새어 들어오면
 * 스펙이 거짓말한다. 타이머 API 는 그대로 둔다(postgres.js 가 진짜 타이머를 쓴다).
 *
 * 로컬 실행(TZ 는 globalSetup 이 박으므로 따로 넘길 것이 없다):
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core \
 *     npx jest --testPathPattern=same-day-cancel.integration --runInBand
 */
describeIfDb('InboundService.cancelInbound 당일 판정 (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: Database;
  let svc: InboundService;

  /** KST 2026-08-25 23:00 — 이중 변환이면 KST 08-26 08:00 로 밀려 "어제"가 된다. */
  const NOW = new Date('2026-08-25T14:00:00Z');

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
    svc = makeInboundService(db);
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(() => {
    jest.useFakeTimers({
      doNotFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'nextTick',
        'queueMicrotask',
        'performance',
        'hrtime',
      ],
    });
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function seedReceivedLine(tx: DbTx, occurredAt: Date) {
    const suffix = randomUUID();
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `sdc-wh-${suffix.slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `sdc-holder-${suffix.slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'sdc sku', code: `SDC-${suffix}`, holderId: holder.id })
      .returning();
    const [supplier] = await tx
      .insert(wmsTables.suppliers)
      .values({ name: `sdc-supplier-${suffix.slice(0, 8)}` })
      .returning();
    const [po] = await tx
      .insert(wmsTables.purchaseOrders)
      .values({
        supplierId: supplier.id,
        type: 'domestic',
        sourceWarehouseId: warehouse.id,
        destinationWarehouseId: warehouse.id,
      })
      .returning();
    const [plan] = await tx
      .insert(wmsTables.inboundPlans)
      .values({
        warehouseId: warehouse.id,
        destinationWarehouseId: warehouse.id,
        linkedPurchaseOrderId: po.id,
        status: 'pending',
      })
      .returning();
    const [item] = await tx
      .insert(wmsTables.inboundPlanItems)
      .values({ planId: plan.id, skuId: sku.id, expectedQty: 20, receivedQty: 0, status: 'pending' })
      .returning();

    const received = await svc.receiveFromPlan({ planItemId: item.id, quantity: 20, idempotencyKey: randomUUID() }, tx);

    // 영수증 시각을 못 박는다 — 실행 시각이 판정에 새어 들어오면 스펙이 거짓말한다.
    const line = await tx.query.inboundReceiptLines.findFirst({
      where: eq(wmsTables.inboundReceiptLines.id, received.lineId),
    });
    await tx
      .update(wmsTables.inboundReceipts)
      .set({ occurredAt })
      .where(eq(wmsTables.inboundReceipts.id, line!.receiptId));

    return { lineId: received.lineId };
  }

  it('서울 기준 같은 날이면 KST 23:00 에도 취소된다', async () => {
    await inRollbackTx(db, async (tx) => {
      // KST 2026-08-25 00:30 — NOW 와 같은 서울 날짜다.
      const { lineId } = await seedReceivedLine(tx, new Date('2026-08-24T15:30:00Z'));

      await expect(
        svc.cancelInbound({ lineId, quantity: 20, idempotencyKey: randomUUID() }, tx),
      ).resolves.toBeDefined();
    });
  });

  it('서울 기준 전날이면 거부한다', async () => {
    await inRollbackTx(db, async (tx) => {
      // KST 2026-08-24 23:30 — NOW 의 전날이다.
      const { lineId } = await seedReceivedLine(tx, new Date('2026-08-24T14:30:00Z'));

      await expect(svc.cancelInbound({ lineId, quantity: 20, idempotencyKey: randomUUID() }, tx)).rejects.toThrow(
        'cancel is allowed only on the same day (Asia/Seoul)',
      );
    });
  });
});
