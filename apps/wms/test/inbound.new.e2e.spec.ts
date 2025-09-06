import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { WmsModule } from '../src/wms.module';
import { DbService } from '@app/db';
import { wmsTables } from '../database/schemas/wms-schema';
import { and, eq, sql } from 'drizzle-orm';

describe('Inbound Extended Flow (e2e)', () => {
  let app: INestApplication;
  let httpServer: any;
  let dbService: DbService<typeof wmsTables>;

  const created: any = { warehouseId: '', skuIds: [], zoneId: '' };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [WmsModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer();
    dbService = app.get(DbService);

    await dbService.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL client_min_messages TO warning`);
      await tx.execute(sql`TRUNCATE TABLE
        inbound_work_logs,
        inbound_receipt_lines,
        inbound_receipts,
        inbound_plan_items,
        inbound_plans,
        stock_events,
        stock_ledgers,
        stock_summary,
        locations,
        location_racks,
        location_columns,
        warehouses,
        sku_barcodes,
        sku_suppliers,
        skus
        RESTART IDENTITY CASCADE`);
    });

    await dbService.db
      .insert(wmsTables.holders)
      .values({ id: '00000000-0000-0000-0000-000000000000', name: 'Default Holder', isOurAsset: true } as any)
      // @ts-ignore
      .onConflictDoNothing({ target: wmsTables.holders.id });
  }, 60000);

  afterAll(async () => {
    await dbService.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL client_min_messages TO warning`);
      await tx.execute(sql`TRUNCATE TABLE
        inbound_work_logs,
        inbound_receipt_lines,
        inbound_receipts,
        inbound_plan_items,
        inbound_plans,
        stock_events,
        stock_ledgers,
        stock_summary,
        locations,
        location_racks,
        location_columns,
        warehouses,
        sku_barcodes,
        sku_suppliers,
        skus
        RESTART IDENTITY CASCADE`);
    });
    await app.close();
  });

  it('should run simple inbound, list receipts/work-logs/status, putaway, return, cancel, plans flow', async () => {
    // Warehouse
    const wh = await request(httpServer)
      .post('/wms/inventory/warehouses')
      .send({ name: 'E2E-WH', type: 'domestic', location: 'Seoul' })
      .expect(201);
    created.warehouseId = wh.body.id;

    // SKUs
    const skuIds: string[] = [];
    for (const name of ['E2E-NEW-SKU-1', 'E2E-NEW-SKU-2']) {
      const skuRes = await request(httpServer)
        .post('/wms/inventory/skus')
        .send({ name })
        .expect(201);
      skuIds.push(skuRes.body.id);
    }
    created.skuIds = skuIds;

    // Simple inbound
    const inboundRes = await request(httpServer)
      .post('/wms/inbound/simple')
      .send({
        warehouseId: created.warehouseId,
        items: [
          { skuId: skuIds[0], quantity: 5, memo: 'E2E-M1' },
          { skuId: skuIds[1], quantity: 3, memo: 'E2E-M2' },
        ],
      })
      .expect(201);
    const receiptId = inboundRes.body.receiptId;

    // verify memos saved on lines
    const receiptLinesWithMemo = await dbService.db.query.inboundReceiptLines.findMany({
      where: eq(wmsTables.inboundReceiptLines.receiptId, receiptId),
    });
    expect(receiptLinesWithMemo.some((l:any) => l.memo === 'E2E-M1')).toBe(true);
    expect(receiptLinesWithMemo.some((l:any) => l.memo === 'E2E-M2')).toBe(true);

    // receipts
    const receipts = await request(httpServer)
      .get('/wms/inbound/receipts')
      .query({ warehouseId: created.warehouseId })
      .expect(200);
    expect(receipts.body.items.length).toBeGreaterThan(0);

    // work-logs
    const logs = await request(httpServer)
      .get('/wms/inbound/work-logs')
      .query({ warehouseId: created.warehouseId })
      .expect(200);
    expect(logs.body.items.some((i: any) => i.type === 'INBOUND')).toBe(true);

    // status
    const status = await request(httpServer)
      .get('/wms/inbound/status')
      .query({ warehouseId: created.warehouseId })
      .expect(200);
    expect(status.body.items.length).toBeGreaterThan(0);

    // Create zone location for putaway
    const sysInbound = await dbService.db.query.locations.findFirst({
      where: and(
        eq(wmsTables.locations.warehouseId, created.warehouseId),
        eq(wmsTables.locations.systemRole as any, 'inbound_default' as any),
      ),
    });
    const [zone] = await dbService.db.insert(wmsTables.locations).values({
      warehouseId: created.warehouseId,
      code: 'E2E-ZONE-1',
      locationType: 'zone',
      isSystem: false,
      displayName: 'E2E Zone',
    } as any).returning();
    created.zoneId = zone.id;

    // get both lines for the receipt
    const lines = await dbService.db.query.inboundReceiptLines.findMany({
      where: eq(wmsTables.inboundReceiptLines.receiptId, receiptId),
    });
    const putawayLine = lines[0]!;
    const untouchedLine = lines[1]!;

    // putaway on first line
    await request(httpServer)
      .post('/wms/inbound/putaway')
      .send({ lineId: putawayLine.id, toLocationId: created.zoneId, quantity: 2 })
      .expect(201);

    // return & cancel on putaway line should fail (origin on-hand insufficient)
    await request(httpServer)
      .post('/wms/inbound/return')
      .send({ lineId: putawayLine.id, quantity: 1 })
      .expect(400);
    await request(httpServer)
      .post('/wms/inbound/cancel')
      .send({ lineId: putawayLine.id, quantity: 1 })
      .expect(400);

    // cancel on untouched line: partial reject, full accept
    const untouchedFullQty = (await dbService.db.query.inboundReceiptLines.findFirst({ where: eq(wmsTables.inboundReceiptLines.id, untouchedLine.id) }))!.quantity as any as number;
    await request(httpServer)
      .post('/wms/inbound/cancel')
      .send({ lineId: untouchedLine.id, quantity: 1 })
      .expect(400);
    await request(httpServer)
      .post('/wms/inbound/cancel')
      .send({ lineId: untouchedLine.id, quantity: untouchedFullQty })
      .expect(201);

    // individual inbound with memo
    const indiv = await request(httpServer)
      .post('/wms/inbound/individual')
      .send({ warehouseId: created.warehouseId, skuId: skuIds[0], quantity: 2, memo: 'E2E-IND' })
      .expect(201);
    const indivLine = await dbService.db.query.inboundReceiptLines.findFirst({
      where: eq(wmsTables.inboundReceiptLines.receiptId, indiv.body.receiptId),
    });
    expect((indivLine as any).memo).toBe('E2E-IND');

    // simple fullscan with method tagging
    const fs = await request(httpServer)
      .post('/wms/inbound/simple-fullscan')
      .send({ warehouseId: created.warehouseId, items: [{ skuId: skuIds[0], quantity: 1, memo: 'FS' }] })
      .expect(201);
    const fsReceipt = await dbService.db.query.inboundReceipts.findFirst({
      where: eq(wmsTables.inboundReceipts.id, fs.body.receiptId),
    });
    expect((fsReceipt as any).method).toBe('simple_fullscan');

    // receipts/status에서 voided가 제외되는지 확인 (취소된 receipt의 라인이 조회되지 않거나 전체 receipt가 제외)
    const receiptsAfterCancel = await request(httpServer)
      .get('/wms/inbound/receipts')
      .query({ warehouseId: created.warehouseId })
      .expect(200);
    expect(receiptsAfterCancel.body.items.every((i:any) => i.receiptId !== receiptId)).toBe(true);

    // plans
    const plan = await request(httpServer)
      .post('/wms/inbound/plans')
      .send({ warehouseId: created.warehouseId, expectedDate: new Date().toISOString().slice(0,10) })
      .expect(201);
    const planId = plan.body.id;
    await request(httpServer)
      .post('/wms/inbound/plans/items')
      .send({ planId, items: [{ skuId: skuIds[0], expectedQty: 4 }] })
      .expect(201);
    const planItems = await request(httpServer)
      .get('/wms/inbound/plans/items')
      .query({ warehouseId: created.warehouseId })
      .expect(200);
    const planItemId = planItems.body.items[0].planItemId;
    await request(httpServer)
      .post('/wms/inbound/plans/receive')
      .send({ planItemId, quantity: 4 })
      .expect(201);
  }, 90000);
});


