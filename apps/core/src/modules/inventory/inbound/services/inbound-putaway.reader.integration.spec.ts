import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { InboundService } from './inbound.service';
import { InboundPutawayReader } from './inbound-putaway.reader';
import {
  Database,
  inRollbackTx,
  makeInboundPutawayReader,
  makeInboundService,
  makeInventoryCommandService,
} from './__fixtures__/inbound-harness';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('InboundPutawayReader.listPending (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: Database;
  let svc: InboundService;
  let reader: InboundPutawayReader;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
    svc = makeInboundService(db);
    reader = makeInboundPutawayReader(db);
  });

  afterAll(async () => {
    await client.end();
  });

  /** 창고 + SKU 만. 시스템 존은 간편입고가 ensureSystemLocations 로 만든다. */
  async function seed(tx: DbTx) {
    const suffix = randomUUID();
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `putaway-wh-${suffix.slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `putaway-holder-${suffix.slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: '무선마우스 블랙', code: `PUTAWAY-${suffix}`, holderId: holder.id })
      .returning();
    return { warehouse, sku };
  }

  /**
   * 비시스템 로케이션. zone 타입이면 rack/bin 이 NULL 이어도 ck_locations_type 을
   * 통과하고, is_system=false 라 ck_locations_system_role 도 만족한다.
   */
  async function seedPlainZone(tx: DbTx, warehouseId: string) {
    const [loc] = await tx
      .insert(wmsTables.locations)
      .values({
        warehouseId,
        code: `A-01-${randomUUID().slice(0, 4)}`,
        locationType: 'zone',
        isSystem: false,
        systemRole: null,
        isActive: true,
      })
      .returning();
    return loc;
  }

  it('시스템 존에 남은 미적치 라인을 잔량과 출발지와 함께 돌려준다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);

      await svc.simpleInbound(
        {
          warehouseId: warehouse.id,
          items: [{ skuId: sku.id, quantity: 20 }],
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      const result = await reader.listPending({ warehouseId: warehouse.id }, tx);

      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({
        skuId: sku.id,
        skuName: '무선마우스 블랙',
        pendingQty: 20,
        originLocationCode: 'zone-inbound-default',
      });
      expect(typeof result.items[0].receivedAt).toBe('string');
    });
  });

  it('전량 적치된 라인은 나오지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);
      const dest = await seedPlainZone(tx, warehouse.id);

      const received = await svc.simpleInbound(
        {
          warehouseId: warehouse.id,
          items: [{ skuId: sku.id, quantity: 20 }],
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      await svc.putawayFromOrigin(
        {
          lineId: received.lines[0].id,
          toLocationId: dest.id,
          quantity: 20,
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      const result = await reader.listPending({ warehouseId: warehouse.id }, tx);
      expect(result.total).toBe(0);
    });
  });

  it('부분 적치 후에는 줄어든 잔량으로 남는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);
      const dest = await seedPlainZone(tx, warehouse.id);

      const received = await svc.simpleInbound(
        {
          warehouseId: warehouse.id,
          items: [{ skuId: sku.id, quantity: 50 }],
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      await svc.putawayFromOrigin(
        {
          lineId: received.lines[0].id,
          toLocationId: dest.id,
          quantity: 30,
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      const result = await reader.listPending({ warehouseId: warehouse.id }, tx);
      expect(result.total).toBe(1);
      expect(result.items[0].pendingQty).toBe(20);
    });
  });

  it('출발지가 비시스템 로케이션이면 나오지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);
      const shelf = await seedPlainZone(tx, warehouse.id);

      await svc.individualInbound(
        {
          warehouseId: warehouse.id,
          skuId: sku.id,
          quantity: 7,
          locationId: shelf.id,
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      const result = await reader.listPending({ warehouseId: warehouse.id }, tx);
      expect(result.total).toBe(0);
    });
  });

  it('회송분은 잔량에서 빠진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);

      const received = await svc.simpleInbound(
        {
          warehouseId: warehouse.id,
          items: [{ skuId: sku.id, quantity: 10 }],
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      await svc.returnInbound({ lineId: received.lines[0].id, quantity: 4, idempotencyKey: randomUUID() }, tx);

      const result = await reader.listPending({ warehouseId: warehouse.id }, tx);
      expect(result.items[0].pendingQty).toBe(6);
    });
  });

  it('다른 창고의 라인은 나오지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);
      const other = await seed(tx);

      await svc.simpleInbound(
        {
          warehouseId: warehouse.id,
          items: [{ skuId: sku.id, quantity: 3 }],
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      const result = await reader.listPending({ warehouseId: other.warehouse.id }, tx);
      expect(result.total).toBe(0);
    });
  });

  it('적치 대신 이동 화면으로 원위치를 이미 비운 라인은 카운터가 그대로여도 큐에서 빠진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);
      const shelf = await seedPlainZone(tx, warehouse.id);

      const received = await svc.simpleInbound(
        {
          warehouseId: warehouse.id,
          items: [{ skuId: sku.id, quantity: 20 }],
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      const before = await reader.listPending({ warehouseId: warehouse.id }, tx);
      expect(before.total).toBe(1);
      const originLocationId = before.items[0].originLocationId;

      // 적치(putawayFromOrigin)를 거치지 않고 이동 화면과 같은 경로(moveInternal)로
      // 원위치 재고를 다른 로케이션으로 옮긴다. putawayFromOriginQty 는 이 경로를
      // 모르므로 그대로 0 이다 — 카운터만 보던 예전 쿼리라면 여전히 "잔여 20"으로
      // 나왔을 라인이다.
      const command = makeInventoryCommandService(db);
      await command.moveInternal(
        {
          skuId: sku.id,
          warehouseId: warehouse.id,
          fromLocationId: originLocationId,
          toLocationId: shelf.id,
          quantity: 20,
        },
        tx,
      );

      const lineAfterMove = await tx.query.inboundReceiptLines.findFirst({
        where: eq(wmsTables.inboundReceiptLines.id, received.lines[0].id),
      });
      expect(lineAfterMove?.putawayFromOriginQty).toBe(0);

      const after = await reader.listPending({ warehouseId: warehouse.id }, tx);
      expect(after.total).toBe(0);
    });
  });

  it('LIMIT 을 넘는 백로그는 200건까지만 돌려주고 truncated 를 알린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);

      const items = Array.from({ length: 201 }, () => ({ skuId: sku.id, quantity: 1 }));
      await svc.simpleInbound({ warehouseId: warehouse.id, items, idempotencyKey: randomUUID() }, tx);

      const result = await reader.listPending({ warehouseId: warehouse.id }, tx);
      expect(result.items).toHaveLength(200);
      expect(result.total).toBe(200);
      expect(result.truncated).toBe(true);
    });
  });

  it('LIMIT 아래면 truncated 가 false 다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);

      await svc.simpleInbound(
        { warehouseId: warehouse.id, items: [{ skuId: sku.id, quantity: 5 }], idempotencyKey: randomUUID() },
        tx,
      );

      const result = await reader.listPending({ warehouseId: warehouse.id }, tx);
      expect(result.truncated).toBe(false);
    });
  });

  it('한 영수증 안의 동시각 라인들도 순서가 결정적이다 — line id 오름차순 tie-break', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);

      // 같은 영수증의 라인들은 occurredAt 이 전부 동률이다 — 1차 정렬키만으로는
      // 어느 라인이 먼저 나올지 결정되지 않는다.
      const items = Array.from({ length: 8 }, () => ({ skuId: sku.id, quantity: 1 }));
      await svc.simpleInbound({ warehouseId: warehouse.id, items, idempotencyKey: randomUUID() }, tx);

      const first = await reader.listPending({ warehouseId: warehouse.id }, tx);
      const second = await reader.listPending({ warehouseId: warehouse.id }, tx);

      const idsFirst = first.items.map((i) => i.lineId);
      const idsSecond = second.items.map((i) => i.lineId);

      // 반복 호출 결과가 같아야 한다 — tie-break 가 없으면 적치 때마다 무효화된
      // 재조회에서 순서가 작업자 손 밑에서 재배열될 수 있다.
      expect(idsFirst).toEqual(idsSecond);
      // tie-break 규칙 자체(line id 오름차순)를 검증한다 — 물리적 삽입 순서가
      // 우연히 id 오름차순과 일치할 확률은 사실상 0이다(무작위 UUID 8개, 1/8!).
      expect(idsFirst).toEqual([...idsFirst].sort());
    });
  });

  it('days 필터는 그 기간 밖의 입고를 제외한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);

      const received = await svc.simpleInbound(
        {
          warehouseId: warehouse.id,
          items: [{ skuId: sku.id, quantity: 5 }],
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      // occurredAt 을 3일 전으로 밀어 rolling 창 밖으로 보낸다.
      // simpleInbound 는 서비스 계층에서 { receipt, lines } 를 돌려준다 —
      // 앱이 보는 HTTP 응답({ id, lines })과 모양이 다르니 헷갈리지 말 것.
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      await tx
        .update(wmsTables.inboundReceipts)
        .set({ occurredAt: threeDaysAgo })
        .where(eq(wmsTables.inboundReceipts.id, received.receipt.id));

      const within = await reader.listPending({ warehouseId: warehouse.id, days: 7 }, tx);
      expect(within.total).toBe(1);

      const outside = await reader.listPending({ warehouseId: warehouse.id, days: 1 }, tx);
      expect(outside.total).toBe(0);

      const all = await reader.listPending({ warehouseId: warehouse.id }, tx);
      expect(all.total).toBe(1);
    });
  });
});
