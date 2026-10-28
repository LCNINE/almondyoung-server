import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, makeDbService, wireLogistics } from '../../fulfillment/services/__support__';
import { seedWorld, World } from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { seedComponentSku, seedDeliveredLine } from '../line-quantities/__support__/claim-facts.fixtures';
import { LineCompositionManager } from '../../product-matching/line-composition/line-composition.manager';
import { CustomerReturnManager } from './customer-return.manager';
import { CustomerReturnReader } from './customer-return.reader';
import { ListCustomerReturnsQueryDto } from './dto/list-customer-returns.dto';
import { ListReceivingCustomerReturnsQueryDto } from './dto/list-receiving-customer-returns.dto';
import { CustomerReturnReceivingManager } from './customer-return-receiving.manager';
import { newPickupRow } from './customer-return-pickup.types';

/**
 * 반품 상세 뷰 — 주문번호·품목명·SKU 이름·환불 기한 (K8 PR7 Task 2). rollback 전용 트랜잭션.
 *
 * 실행: DATABASE_URL=<scratch core DB> npx jest apps/core/src/modules/sales-order/customer-return --runInBand
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('CustomerReturnReader — 상세 뷰 (K8 PR7)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  const dbService = makeDbService(db);
  const { command, location } = wireLogistics(dbService);
  afterAll(async () => {
    await client.end();
  });

  const actorId = 'cs-1';

  function wire() {
    const publisher = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const reader = new CustomerReturnReader(dbService);
    const intake = new CustomerReturnManager(dbService, publisher as never, new LineCompositionManager(dbService));
    const receiving = new CustomerReturnReceivingManager(
      dbService,
      reader,
      command,
      publisher as never,
      publisher as never,
    );
    return { reader, intake, receiving };
  }
  type Wired = ReturnType<typeof wire>;

  /** 배송완료 소포가 있는 Medusa 회원 주문 + PR 5 반품 기록. 기본: 단품(SKU × 1) 2개 배송완료, 2개 반품. */
  async function seed(
    tx: DbTx,
    w: World,
    wired: Wired,
    opts: { quantity?: number; composition?: Array<{ skuId: string; qtyPerUnit: number }> } = {},
  ) {
    const quantity = opts.quantity ?? 2;
    const composition = opts.composition ?? [{ skuId: w.skuId, qtyPerUnit: 1 }];
    await location.ensureSystemLocations(w.warehouseId, tx);
    const line = await seedDeliveredLine(tx, w, {
      quantity,
      composition,
      parcels: [{ qtyBySku: Object.fromEntries(composition.map((c) => [c.skuId, c.qtyPerUnit * quantity])) }],
      customerId: randomUUID(),
    });
    const channelOrderItemId = `item_${randomUUID().slice(0, 8)}`;
    await tx
      .update(wmsTables.salesOrderLines)
      .set({ channelOrderItemId })
      .where(eq(wmsTables.salesOrderLines.id, line.lineId));
    const [so] = await tx
      .select({ channelOrderId: wmsTables.salesOrders.channelOrderId })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, line.salesOrderId));
    const channelReturnId = `ret_${randomUUID().slice(0, 8)}`;
    const { customerReturnId } = await wired.intake.recordRequested(
      {
        orderId: 'ignored',
        salesChannel: 'medusa',
        externalOrderId: so.channelOrderId,
        returnId: channelReturnId,
        requestId: `req_${randomUUID().slice(0, 8)}`,
        reason: 'defective',
        feeBearer: 'seller',
        requestedBy: 'customer',
        requestedAt: '2026-10-27T01:00:00.000Z',
        items: [{ channelOrderItemId, quantity }],
      },
      tx,
    );
    const items = await tx
      .select({ id: wmsTables.customerReturnItems.id, skuId: wmsTables.customerReturnItems.skuId })
      .from(wmsTables.customerReturnItems)
      .innerJoin(
        wmsTables.customerReturnLines,
        eq(wmsTables.customerReturnLines.id, wmsTables.customerReturnItems.customerReturnLineId),
      )
      .where(eq(wmsTables.customerReturnLines.customerReturnId, customerReturnId));
    const itemIdBySku = new Map(items.map((i) => [i.skuId, i.id]));
    const itemOf = (skuId: string) => {
      const id = itemIdBySku.get(skuId);
      if (!id) throw new Error(`no customer return item for sku ${skuId}`);
      return id;
    };
    const arrive = (items: Array<{ skuId: string; quantity: number }>, key = `parcel-${randomUUID()}`) =>
      wired.receiving.recordArrival(
        {
          customerReturnId,
          warehouseId: w.warehouseId,
          items: items.map((i) => ({ customerReturnItemId: itemOf(i.skuId), quantity: i.quantity })),
          idempotencyKey: key,
          actorId,
        },
        tx,
      );
    const inspect = (items: Array<{ skuId: string; accepted: number; rejected?: number; held?: number }>) =>
      wired.receiving.recordInspection(
        {
          customerReturnId,
          items: items.map((i) => ({
            customerReturnItemId: itemOf(i.skuId),
            accepted: i.accepted,
            rejected: i.rejected ?? 0,
            held: i.held ?? 0,
          })),
          actorId,
        },
        tx,
      );
    return {
      ...line,
      channelOrderItemId,
      channelOrderId: so.channelOrderId,
      channelReturnId,
      customerReturnId,
      itemOf,
      arrive,
      inspect,
    };
  }

  it('상세가 주문번호·채널 주문 id·판매 채널·줄 품목명·SKU 이름·코드를 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const wired = wire();
      const s = await seed(tx, w, wired);
      await tx
        .update(wmsTables.salesOrders)
        .set({ displayOrderNo: '3900' })
        .where(eq(wmsTables.salesOrders.id, s.salesOrderId));
      const [sku] = await tx
        .select({ name: wmsTables.skus.name, code: wmsTables.skus.code })
        .from(wmsTables.skus)
        .where(eq(wmsTables.skus.id, w.skuId));
      const [line] = await tx
        .select({ productName: wmsTables.salesOrderLines.productName })
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.id, s.lineId));

      const view = await wired.reader.findById(s.customerReturnId, tx);
      expect(view.order).toEqual({ orderNo: '3900', channelOrderId: s.channelOrderId, salesChannel: 'medusa' });
      expect(view.lines[0].productName).toBe(line.productName);
      expect(view.lines[0].items[0]).toMatchObject({ skuName: sku.name, skuCode: sku.code });

      await tx
        .update(wmsTables.salesOrders)
        .set({ displayOrderNo: null })
        .where(eq(wmsTables.salesOrders.id, s.salesOrderId));
      const fallback = await wired.reader.findById(s.customerReturnId, tx);
      expect(fallback.order.orderNo).toBe(s.channelOrderId);
    });
  });

  it('항목이 SKU 바코드를 주 바코드 먼저 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const wired = wire();
      const s = await seed(tx, w, wired);
      const tag = randomUUID().slice(0, 8);
      await tx.insert(wmsTables.skuBarcodes).values([
        { skuId: w.skuId, barcode: `A1-${tag}`, isPrimary: false },
        { skuId: w.skuId, barcode: `B2-${tag}`, isPrimary: true },
      ]);

      const view = await wired.reader.findById(s.customerReturnId, tx);
      expect(view.lines[0].items[0].barcodes).toEqual([`B2-${tag}`, `A1-${tag}`]);

      await tx.delete(wmsTables.skuBarcodes).where(eq(wmsTables.skuBarcodes.skuId, w.skuId));
      const none = await wired.reader.findById(s.customerReturnId, tx);
      expect(none.lines[0].items[0].barcodes).toEqual([]);
      expect(none.inspectedBy).toBeNull();
    });
  });

  it('도착 전엔 refundDueAt 이 null, 도착하면 첫 도착 시각으로 계산한 값', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const wired = wire();
      const s = await seed(tx, w, wired);
      expect((await wired.reader.findById(s.customerReturnId, tx)).refundDueAt).toBeNull();

      await s.arrive([{ skuId: w.skuId, quantity: 1 }]);
      await tx
        .update(wmsTables.customerReturns)
        .set({ arrivedAt: new Date('2026-10-26T03:00:00Z') })
        .where(eq(wmsTables.customerReturns.id, s.customerReturnId));
      const view = await wired.reader.findById(s.customerReturnId, tx);
      expect(view.arrivedAt).toBe('2026-10-26T03:00:00.000Z');
      expect(view.refundDueAt).toBe('2026-10-29T14:59:59.999Z');
    });
  });

  it('기한 넘김 사유와 취소 시각을 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const wired = wire();
      const s = await seed(tx, w, wired);
      const plain = await wired.reader.findById(s.customerReturnId, tx);
      expect(plain.windowOverrideReason).toBeNull();
      expect(plain.cancelledAt).toBeNull();

      await tx
        .update(wmsTables.customerReturns)
        .set({ windowOverrideReason: '고객센터 승인', cancelledAt: new Date('2026-10-27T05:00:00Z') })
        .where(eq(wmsTables.customerReturns.id, s.customerReturnId));
      const view = await wired.reader.findById(s.customerReturnId, tx);
      expect(view.windowOverrideReason).toBe('고객센터 승인');
      expect(view.cancelledAt).toBe('2026-10-27T05:00:00.000Z');
    });
  });

  describe('목록 (K8 PR7 N2)', () => {
    const NOW = new Date('2026-10-28T03:00:00Z');
    const query = (over: Partial<ListCustomerReturnsQueryDto> = {}): ListCustomerReturnsQueryDto =>
      Object.assign(new ListCustomerReturnsQueryDto(), over);

    async function seedReturn(
      tx: DbTx,
      wired: Wired,
      set: Partial<typeof wmsTables.customerReturns.$inferInsert> = {},
      orderSet: Partial<typeof wmsTables.salesOrders.$inferInsert> = {},
    ) {
      const w = await seedWorld(tx);
      const s = await seed(tx, w, wired);
      if (Object.keys(set).length > 0) {
        await tx.update(wmsTables.customerReturns).set(set).where(eq(wmsTables.customerReturns.id, s.customerReturnId));
      }
      if (Object.keys(orderSet).length > 0) {
        await tx.update(wmsTables.salesOrders).set(orderSet).where(eq(wmsTables.salesOrders.id, s.salesOrderId));
      }
      return s;
    }
    const idsOf = (page: { items: Array<{ id: string }> }, mine: string[]) =>
      page.items.map((i) => i.id).filter((id) => mine.includes(id));

    it('open 은 settled·cancelled 를 빼고 기한 이른 순, 도착 없는 반품은 뒤', async () => {
      await inRollbackTx(db, async (tx) => {
        const wired = wire();
        const late = await seedReturn(tx, wired, { arrivedAt: new Date('2026-10-27T03:00:00Z'), status: 'arrived' });
        const early = await seedReturn(tx, wired, { arrivedAt: new Date('2026-10-20T03:00:00Z'), status: 'arrived' });
        const none = await seedReturn(tx, wired);
        const settled = await seedReturn(tx, wired, { status: 'settled', settledAt: new Date('2026-10-26T00:00:00Z') });
        const cancelled = await seedReturn(tx, wired, {
          status: 'cancelled',
          cancelledAt: new Date('2026-10-26T00:00:00Z'),
        });
        const mine = [late, early, none, settled, cancelled].map((s) => s.customerReturnId);
        const page = await wired.reader.list(query({ limit: 100 }), NOW, tx);
        expect(idsOf(page, mine)).toEqual([early.customerReturnId, late.customerReturnId, none.customerReturnId]);
      });
    });

    it('held·refund_pending·inspected 는 open 에 남는다', async () => {
      await inRollbackTx(db, async (tx) => {
        const wired = wire();
        const a = await seedReturn(tx, wired, { status: 'held' });
        const b = await seedReturn(tx, wired, { status: 'refund_pending' });
        const c = await seedReturn(tx, wired, { status: 'inspected' });
        const mine = [a, b, c].map((s) => s.customerReturnId);
        const page = await wired.reader.list(query({ limit: 100 }), NOW, tx);
        expect(idsOf(page, mine).sort()).toEqual([...mine].sort());
      });
    });

    it('attention 은 확인 필요가 있는 것만, attentionCount 는 세 bucket 에서 같다', async () => {
      await inRollbackTx(db, async (tx) => {
        const wired = wire();
        const held = await seedReturn(tx, wired, { status: 'held' });
        const fine = await seedReturn(tx, wired);
        const closed = await seedReturn(tx, wired, { status: 'settled', settledAt: new Date('2026-10-26T00:00:00Z') });
        const mine = [held, fine, closed].map((s) => s.customerReturnId);
        const att = await wired.reader.list(query({ bucket: 'attention', limit: 100 }), NOW, tx);
        expect(idsOf(att, mine)).toEqual([held.customerReturnId]);
        expect(att.items.find((i) => i.id === held.customerReturnId)?.attention).toEqual(['held']);
        const open = await wired.reader.list(query({ limit: 100 }), NOW, tx);
        const done = await wired.reader.list(query({ bucket: 'closed', limit: 100 }), NOW, tx);
        expect(open.attentionCount).toBe(att.attentionCount);
        expect(done.attentionCount).toBe(att.attentionCount);
        expect(att.total).toBe(att.attentionCount);
      });
    });

    it('closed 는 끝난 순 최신부터, limit·offset 이 자른다', async () => {
      await inRollbackTx(db, async (tx) => {
        const wired = wire();
        const old = await seedReturn(tx, wired, { status: 'settled', settledAt: new Date('2026-10-20T00:00:00Z') });
        const mid = await seedReturn(tx, wired, { status: 'cancelled', cancelledAt: new Date('2026-10-22T00:00:00Z') });
        const recent = await seedReturn(tx, wired, { status: 'settled', settledAt: new Date('2026-10-26T00:00:00Z') });
        const mine = [old, mid, recent].map((s) => s.customerReturnId);
        const all = await wired.reader.list(query({ bucket: 'closed', limit: 100 }), NOW, tx);
        expect(idsOf(all, mine)).toEqual([recent.customerReturnId, mid.customerReturnId, old.customerReturnId]);
        expect(all.total).toBeGreaterThanOrEqual(3);
        const first = await wired.reader.list(query({ bucket: 'closed', limit: 1, offset: 0 }), NOW, tx);
        const second = await wired.reader.list(query({ bucket: 'closed', limit: 1, offset: 1 }), NOW, tx);
        expect(first.items).toHaveLength(1);
        expect(second.items).toHaveLength(1);
        expect(first.items[0].id).toBe(all.items[0].id);
        expect(second.items[0].id).toBe(all.items[1].id);
        expect(first.total).toBe(all.total);
      });
    });

    it('q 는 주문번호 정확 일치·채널 주문 id 정확 일치·고객명 부분 일치', async () => {
      await inRollbackTx(db, async (tx) => {
        const wired = wire();
        const a = await seedReturn(tx, wired, {}, { displayOrderNo: '987654', customerName: '김철수' });
        const b = await seedReturn(tx, wired, {}, { displayOrderNo: '9876540', customerName: '박영희' });
        const ids = async (q: string, bucket: 'open' | 'closed' = 'open') =>
          (await wired.reader.list(query({ q, bucket, limit: 100 }), NOW, tx)).items.map((i) => i.id);
        expect(await ids('987654')).toEqual([a.customerReturnId]);
        expect(await ids(a.channelOrderId)).toEqual([a.customerReturnId]);
        expect(await ids('영희')).toEqual([b.customerReturnId]);
        expect(await ids('없는사람')).toEqual([]);
        await tx
          .update(wmsTables.customerReturns)
          .set({ status: 'settled', settledAt: new Date('2026-10-26T00:00:00Z') })
          .where(eq(wmsTables.customerReturns.id, b.customerReturnId));
        expect(await ids('영희', 'closed')).toEqual([b.customerReturnId]);
        expect(await ids('영희')).toEqual([]);
      });
    });

    it('행이 orderNo·customerName·quantity·productSummary·refundAmount 를 싣는다', async () => {
      await inRollbackTx(db, async (tx) => {
        const wired = wire();
        const s = await seedReturn(
          tx,
          wired,
          {
            status: 'settled',
            settledAt: new Date('2026-10-26T00:00:00Z'),
            settlementOutcome: {
              refundAmount: 12300,
              deduction: { amount: 0, kind: 'none' } as never,
              feeNotAdjusted: false,
              refundMode: 'auto',
              settledAt: '2026-10-26T00:00:00.000Z',
            },
          },
          { displayOrderNo: '4242', customerName: '홍길동' },
        );
        const [line] = await tx
          .select({ productName: wmsTables.salesOrderLines.productName })
          .from(wmsTables.salesOrderLines)
          .where(eq(wmsTables.salesOrderLines.id, s.lineId));
        const page = await wired.reader.list(query({ bucket: 'closed', q: '4242' }), NOW, tx);
        expect(page.items).toHaveLength(1);
        expect(page.items[0]).toMatchObject({
          id: s.customerReturnId,
          salesOrderId: s.salesOrderId,
          orderNo: '4242',
          channelOrderId: s.channelOrderId,
          customerName: '홍길동',
          status: 'settled',
          reason: 'defective',
          quantity: 2,
          productSummary: line.productName,
          refundAmount: 12300,
          settledAt: '2026-10-26T00:00:00.000Z',
          cancelledAt: null,
          attention: [],
        });

        // 줄이 둘이면 «첫 품목 외 1건» — 같은 주문에 두 번째 줄과 그 반품 줄을 직접 더한다
        const w = await seedWorld(tx);
        const two = await seed(tx, w, wired);
        const [first] = await tx
          .select({
            productName: wmsTables.salesOrderLines.productName,
            variantId: wmsTables.salesOrderLines.variantId,
          })
          .from(wmsTables.salesOrderLines)
          .where(eq(wmsTables.salesOrderLines.id, two.lineId));
        const [second] = await tx
          .insert(wmsTables.salesOrderLines)
          .values({
            salesOrderId: two.salesOrderId,
            variantId: first.variantId,
            productName: 'ZZ 둘째 품목',
            quantity: 3,
            channelOrderItemId: `zzz_${randomUUID().slice(0, 8)}`,
          })
          .returning({ id: wmsTables.salesOrderLines.id, itemId: wmsTables.salesOrderLines.channelOrderItemId });
        await tx.insert(wmsTables.customerReturnLines).values({
          customerReturnId: two.customerReturnId,
          salesOrderLineId: second.id,
          channelOrderItemId: second.itemId ?? '',
          quantity: 3,
        });
        const page2 = await wired.reader.list(query({ q: two.channelOrderId }), NOW, tx);
        expect(page2.items[0].productSummary).toBe(`${first.productName} 외 1건`);
        expect(page2.items[0].quantity).toBe(5);
      });
    });
  });

  describe('listForReceiving (K8 PR7b N3)', () => {
    const receivingQuery = (
      warehouseId: string,
      over: Partial<ListReceivingCustomerReturnsQueryDto> = {},
    ): ListReceivingCustomerReturnsQueryDto =>
      Object.assign(new ListReceivingCustomerReturnsQueryDto(), { warehouseId }, over);
    const setReturn = (tx: DbTx, id: string, set: Partial<typeof wmsTables.customerReturns.$inferInsert>) =>
      tx.update(wmsTables.customerReturns).set(set).where(eq(wmsTables.customerReturns.id, id));

    it('W 가 배송완료한 expected 반품만 awaiting 으로 싣고, 다른 창고가 배송한 주문은 뺀다', async () => {
      await inRollbackTx(db, async (tx) => {
        const wired = wire();
        const w = await seedWorld(tx);
        const w2 = await seedWorld(tx);
        const mine = await seed(tx, w, wired);
        const theirs = await seed(tx, w2, wired);
        await tx
          .update(wmsTables.salesOrders)
          .set({ displayOrderNo: '7100', customerName: '홍길동' })
          .where(eq(wmsTables.salesOrders.id, mine.salesOrderId));
        const [line] = await tx
          .select({ productName: wmsTables.salesOrderLines.productName })
          .from(wmsTables.salesOrderLines)
          .where(eq(wmsTables.salesOrderLines.id, mine.lineId));

        const page = await wired.reader.listForReceiving(receivingQuery(w.warehouseId), tx);
        expect(page.items).toEqual([
          {
            id: mine.customerReturnId,
            orderNo: '7100',
            customerMasked: '홍길*',
            productSummary: line.productName,
            expectedQty: 2,
            arrivedQty: 0,
            stage: 'awaiting',
            requestedAt: '2026-10-27T01:00:00.000Z',
          },
        ]);
        expect(page.total).toBe(1);
        const atW2 = await wired.reader.listForReceiving(receivingQuery(w2.warehouseId), tx);
        expect(atW2.items.map((i) => i.id)).toEqual([theirs.customerReturnId]);
        // 고객명이 없으면 빈 문자열, 주문번호가 없으면 채널 주문 id
        expect(atW2.items[0]).toMatchObject({ orderNo: theirs.channelOrderId, customerMasked: '' });
      });
    });

    it('W 에서 첫 도착한 반품은 W 에만 보인다', async () => {
      await inRollbackTx(db, async (tx) => {
        const wired = wire();
        const w = await seedWorld(tx);
        const w2 = await seedWorld(tx);
        const s = await seed(tx, w, wired);
        await s.arrive([{ skuId: w.skuId, quantity: 1 }]);
        // 소포의 창고를 W2 로 옮겨도(«W2 가 배송완료») 받기 시작한 반품은 첫 도착 창고에만 남는다
        await tx
          .update(wmsTables.shipments)
          .set({ warehouseId: w2.warehouseId })
          .where(eq(wmsTables.shipments.id, s.parcels[0].shipmentId));

        const atW = await wired.reader.listForReceiving(receivingQuery(w.warehouseId), tx);
        expect(atW.items.map((i) => [i.id, i.stage])).toEqual([[s.customerReturnId, 'partial']]);
        const atW2 = await wired.reader.listForReceiving(receivingQuery(w2.warehouseId), tx);
        expect(atW2).toEqual({ items: [], total: 0 });
      });
    });

    it('단계: 덜 온 arrived 는 partial, 다 온 arrived·미도착으로 닫힌 arrived 는 ready', async () => {
      await inRollbackTx(db, async (tx) => {
        const wired = wire();
        const w = await seedWorld(tx);
        const partial = await seed(tx, w, wired);
        await partial.arrive([{ skuId: w.skuId, quantity: 1 }]);
        const full = await seed(tx, w, wired);
        await full.arrive([{ skuId: w.skuId, quantity: 2 }]);
        const closed = await seed(tx, w, wired);
        await closed.arrive([{ skuId: w.skuId, quantity: 1 }]);
        await setReturn(tx, closed.customerReturnId, {
          csResolution: { missing: { memo: '한 개 안 옴', by: 'cs-1', at: '2026-10-27T05:00:00.000Z' } },
        });

        const page = await wired.reader.listForReceiving(receivingQuery(w.warehouseId), tx);
        const byId = new Map(page.items.map((i) => [i.id, i]));
        expect(byId.get(partial.customerReturnId)).toMatchObject({ stage: 'partial', expectedQty: 2, arrivedQty: 1 });
        expect(byId.get(full.customerReturnId)).toMatchObject({ stage: 'ready', expectedQty: 2, arrivedQty: 2 });
        expect(byId.get(closed.customerReturnId)).toMatchObject({ stage: 'ready', expectedQty: 2, arrivedQty: 1 });
        expect(page.total).toBe(3);
      });
    });

    it('inspected·held·cancelled 는 싣지 않는다', async () => {
      await inRollbackTx(db, async (tx) => {
        const wired = wire();
        const w = await seedWorld(tx);
        const inspected = await seed(tx, w, wired);
        await inspected.arrive([{ skuId: w.skuId, quantity: 2 }]);
        await inspected.inspect([{ skuId: w.skuId, accepted: 2 }]);
        const held = await seed(tx, w, wired);
        await held.arrive([{ skuId: w.skuId, quantity: 2 }]);
        await held.inspect([{ skuId: w.skuId, accepted: 1, held: 1 }]);
        const cancelled = await seed(tx, w, wired);
        await setReturn(tx, cancelled.customerReturnId, {
          status: 'cancelled',
          cancelledAt: new Date('2026-10-27T05:00:00Z'),
        });
        const open = await seed(tx, w, wired);

        expect((await wired.reader.findById(inspected.customerReturnId, tx)).status).toBe('inspected');
        expect((await wired.reader.findById(held.customerReturnId, tx)).status).toBe('held');
        const page = await wired.reader.listForReceiving(receivingQuery(w.warehouseId), tx);
        expect(page.items.map((i) => i.id)).toEqual([open.customerReturnId]);
        expect(page.total).toBe(1);
      });
    });

    it('정렬은 ready → partial → awaiting, 그다음 요청 이른 순', async () => {
      await inRollbackTx(db, async (tx) => {
        const wired = wire();
        const w = await seedWorld(tx);
        const awaitingLate = await seed(tx, w, wired);
        const awaitingEarly = await seed(tx, w, wired);
        const tieA = await seed(tx, w, wired);
        const tieB = await seed(tx, w, wired);
        const partial = await seed(tx, w, wired);
        await partial.arrive([{ skuId: w.skuId, quantity: 1 }]);
        const ready = await seed(tx, w, wired);
        await ready.arrive([{ skuId: w.skuId, quantity: 2 }]);
        // 받는 쪽일수록 요청이 늦게 — 단계가 시각보다 먼저인지 본다
        await setReturn(tx, ready.customerReturnId, { requestedAt: new Date('2026-10-27T09:00:00Z') });
        await setReturn(tx, partial.customerReturnId, { requestedAt: new Date('2026-10-27T08:00:00Z') });
        await setReturn(tx, awaitingLate.customerReturnId, { requestedAt: new Date('2026-10-27T03:00:00Z') });
        await setReturn(tx, awaitingEarly.customerReturnId, { requestedAt: new Date('2026-10-27T01:00:00Z') });
        await setReturn(tx, tieA.customerReturnId, { requestedAt: new Date('2026-10-27T02:00:00Z') });
        await setReturn(tx, tieB.customerReturnId, { requestedAt: new Date('2026-10-27T02:00:00Z') });
        const ties = [tieA.customerReturnId, tieB.customerReturnId].sort();

        const page = await wired.reader.listForReceiving(receivingQuery(w.warehouseId), tx);
        expect(page.items.map((i) => i.id)).toEqual([
          ready.customerReturnId,
          partial.customerReturnId,
          awaitingEarly.customerReturnId,
          ...ties,
          awaitingLate.customerReturnId,
        ]);
        expect(page.items.map((i) => i.stage)).toEqual([
          'ready',
          'partial',
          'awaiting',
          'awaiting',
          'awaiting',
          'awaiting',
        ]);
      });
    });

    it('q 는 주문번호 정확 일치·고객명 부분 일치, barcode 는 정확 일치로 그 SKU 를 가진 반품만', async () => {
      await inRollbackTx(db, async (tx) => {
        const wired = wire();
        const w = await seedWorld(tx);
        const a = await seed(tx, w, wired);
        const otherSku = await seedComponentSku(tx, w);
        const b = await seed(tx, w, wired, { composition: [{ skuId: otherSku, qtyPerUnit: 1 }] });
        await tx
          .update(wmsTables.salesOrders)
          .set({ displayOrderNo: '5501', customerName: '홍길동' })
          .where(eq(wmsTables.salesOrders.id, a.salesOrderId));
        await tx
          .update(wmsTables.salesOrders)
          .set({ displayOrderNo: '55010', customerName: '김영희' })
          .where(eq(wmsTables.salesOrders.id, b.salesOrderId));
        const tag = randomUUID().slice(0, 8);
        await tx.insert(wmsTables.skuBarcodes).values([
          { skuId: w.skuId, barcode: `880-A-${tag}`, isPrimary: true },
          { skuId: otherSku, barcode: `880-B-${tag}`, isPrimary: true },
          { skuId: otherSku, barcode: `880-B2-${tag}`, isPrimary: false },
        ]);
        const ids = (over: Partial<ListReceivingCustomerReturnsQueryDto>) =>
          wired.reader
            .listForReceiving(receivingQuery(w.warehouseId, over), tx)
            .then((page) => page.items.map((i) => i.id));

        expect(await ids({ q: '5501' })).toEqual([a.customerReturnId]);
        expect(await ids({ q: b.channelOrderId })).toEqual([b.customerReturnId]);
        expect(await ids({ q: '길동' })).toEqual([a.customerReturnId]);
        expect(await ids({ q: '%' })).toEqual([]);
        const named = await wired.reader.listForReceiving(receivingQuery(w.warehouseId, { q: '홍' }), tx);
        expect(named.items.map((i) => i.customerMasked)).toEqual(['홍길*']);

        expect(await ids({ barcode: `880-A-${tag}` })).toEqual([a.customerReturnId]);
        expect(await ids({ barcode: `880-B2-${tag}` })).toEqual([b.customerReturnId]);
        expect(await ids({ barcode: `880-B` })).toEqual([]);
        expect(await ids({ barcode: `880-A-${tag}`, q: '김영희' })).toEqual([]);
      });
    });

    it('limit 을 넘으면 items 는 자르고 total 은 전체', async () => {
      await inRollbackTx(db, async (tx) => {
        const wired = wire();
        const w = await seedWorld(tx);
        const seeded = [await seed(tx, w, wired), await seed(tx, w, wired), await seed(tx, w, wired)];
        const page = await wired.reader.listForReceiving(receivingQuery(w.warehouseId, { limit: 2 }), tx);
        expect(page.items).toHaveLength(2);
        expect(page.total).toBe(3);
        const all = await wired.reader.listForReceiving(receivingQuery(w.warehouseId), tx);
        expect(all.items.map((i) => i.id).sort()).toEqual(seeded.map((s) => s.customerReturnId).sort());
        expect(page.items).toEqual(all.items.slice(0, 2));
      });
    });
  });

  describe('회수 (K8 PR9)', () => {
    const NOW = new Date('2026-10-28T03:00:00Z');
    const query = (over: Partial<ListCustomerReturnsQueryDto> = {}): ListCustomerReturnsQueryDto =>
      Object.assign(new ListCustomerReturnsQueryDto(), over);
    const receivingQuery = (
      warehouseId: string,
      over: Partial<ListReceivingCustomerReturnsQueryDto> = {},
    ): ListReceivingCustomerReturnsQueryDto =>
      Object.assign(new ListReceivingCustomerReturnsQueryDto(), { warehouseId }, over);

    async function addPickup(
      tx: DbTx,
      customerReturnId: string,
      set: Partial<typeof wmsTables.customerReturnPickups.$inferInsert>,
    ) {
      const row = newPickupRow(customerReturnId, null);
      await tx.insert(wmsTables.customerReturnPickups).values({ ...row, ...set });
      return row;
    }
    /** 접수가 자동으로 만든 pending 행을 치운다 — 행 이력을 스펙이 정한다 */
    const clearPickups = (tx: DbTx, ...ids: string[]) =>
      Promise.all(
        ids.map((id) =>
          tx.delete(wmsTables.customerReturnPickups).where(eq(wmsTables.customerReturnPickups.customerReturnId, id)),
        ),
      );
    const wb = () => `5600${Math.floor(Math.random() * 1e8)}`.slice(0, 12);

    it('상세는 마지막 회수 행(cancelled 뒤 reserved)을 싣고, 목록은 pickupWaybillNo 를 싣는다. 행이 없으면 null', async () => {
      await inRollbackTx(db, async (tx) => {
        const wired = wire();
        const w = await seedWorld(tx);
        const withRows = await seed(tx, w, wired);
        const none = await seed(tx, w, wired);
        const waybillNo = wb();
        await clearPickups(tx, withRows.customerReturnId, none.customerReturnId);
        await addPickup(tx, withRows.customerReturnId, {
          status: 'cancelled',
          waybillNo: wb(),
          cancelledAt: new Date('2026-10-27T02:00:00Z'),
          createdAt: new Date('2026-10-27T01:00:00Z'),
        });
        await addPickup(tx, withRows.customerReturnId, {
          status: 'reserved',
          waybillNo,
          originalWaybillNo: 'WB-ORIG',
          attempts: 2,
          lastError: null,
          reservedAt: new Date('2026-10-27T04:00:00Z'),
          createdAt: new Date('2026-10-27T03:00:00Z'),
        });

        const view = await wired.reader.findById(withRows.customerReturnId, tx);
        expect(view.pickup).toEqual({
          status: 'reserved',
          waybillNo,
          originalWaybillNo: 'WB-ORIG',
          lastError: null,
          attempts: 2,
          reservedAt: '2026-10-27T04:00:00.000Z',
          pickedUpAt: null,
          cancelledAt: null,
          createdAt: '2026-10-27T03:00:00.000Z',
        });
        expect((await wired.reader.findById(none.customerReturnId, tx)).pickup).toBeNull();

        const page = await wired.reader.list(query({ limit: 100 }), NOW, tx);
        const by = new Map(page.items.map((i) => [i.id, i]));
        expect(by.get(withRows.customerReturnId)?.pickupWaybillNo).toBe(waybillNo);
        expect(by.get(none.customerReturnId)?.pickupWaybillNo).toBeNull();
      });
    });

    it('expected + 마지막 회수 failed 는 pickup_failed, 도착한 반품은 아니다', async () => {
      await inRollbackTx(db, async (tx) => {
        const wired = wire();
        const w = await seedWorld(tx);
        const a = await seed(tx, w, wired);
        const b = await seed(tx, w, wired);
        await clearPickups(tx, a.customerReturnId, b.customerReturnId);
        await addPickup(tx, a.customerReturnId, { status: 'failed', lastError: 'ERROR-14: x', attempts: 1 });
        await addPickup(tx, b.customerReturnId, { status: 'failed', lastError: 'ERROR-14: x', attempts: 1 });
        await b.arrive([{ skuId: w.skuId, quantity: 1 }]);
        const page = await wired.reader.list(query({ limit: 100 }), NOW, tx);
        const by = new Map(page.items.map((i) => [i.id, i]));
        expect(by.get(a.customerReturnId)?.attention).toEqual(['pickup_failed']);
        expect(by.get(b.customerReturnId)?.attention).not.toContain('pickup_failed');
      });
    });

    it('CS 목록 q 와 창고 목록 q·barcode 가 회수 운송장번호 정확 일치로 찾는다 — 끝난 행도, 끝난 반품은 창고에 안 보인다', async () => {
      await inRollbackTx(db, async (tx) => {
        const wired = wire();
        const w = await seedWorld(tx);
        const a = await seed(tx, w, wired);
        const b = await seed(tx, w, wired);
        const closed = await seed(tx, w, wired);
        const wa = wb();
        const oldWa = wb();
        const wc = wb();
        await clearPickups(tx, a.customerReturnId, b.customerReturnId, closed.customerReturnId);
        await addPickup(tx, a.customerReturnId, { status: 'reserved', waybillNo: wa });
        await addPickup(tx, b.customerReturnId, {
          status: 'cancelled',
          waybillNo: oldWa,
          cancelledAt: new Date(),
          createdAt: new Date('2026-10-27T01:00:00Z'),
        });
        await addPickup(tx, b.customerReturnId, { status: 'pending', createdAt: new Date('2026-10-27T02:00:00Z') });
        await addPickup(tx, closed.customerReturnId, { status: 'reserved', waybillNo: wc });
        await tx
          .update(wmsTables.customerReturns)
          .set({ status: 'settled', settledAt: new Date('2026-10-26T00:00:00Z') })
          .where(eq(wmsTables.customerReturns.id, closed.customerReturnId));

        const cs = async (q: string, bucket: 'open' | 'closed' = 'open') =>
          (await wired.reader.list(query({ q, bucket, limit: 100 }), NOW, tx)).items.map((i) => i.id);
        expect(await cs(wa)).toEqual([a.customerReturnId]);
        expect(await cs(oldWa)).toEqual([b.customerReturnId]);
        expect(await cs(wa.slice(0, -1))).toEqual([]);
        expect(await cs(wc, 'closed')).toEqual([closed.customerReturnId]);
        expect(await cs(wc)).toEqual([]);

        const rcv = async (over: Partial<ListReceivingCustomerReturnsQueryDto>) =>
          (await wired.reader.listForReceiving(receivingQuery(w.warehouseId, over), tx)).items.map((i) => i.id);
        expect(await rcv({ q: wa })).toEqual([a.customerReturnId]);
        expect(await rcv({ barcode: wa })).toEqual([a.customerReturnId]);
        expect(await rcv({ barcode: oldWa })).toEqual([b.customerReturnId]);
        expect(await rcv({ barcode: wc })).toEqual([]);
        expect(await rcv({ q: wc })).toEqual([]);
      });
    });
  });
});
