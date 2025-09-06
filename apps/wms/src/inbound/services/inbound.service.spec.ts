import { Test, TestingModule } from '@nestjs/testing';
import { InboundService } from './inbound.service';
import { WmsModule } from '../../wms.module';
import { DbService } from '@app/db';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { eq, and, sql } from 'drizzle-orm';

describe('InboundService (unit-like)', () => {
  let module: TestingModule;
  let service: InboundService;
  let dbService: DbService<typeof wmsTables>;

  const created = {
    warehouseId: '' as string,
    locationIds: [] as string[],
    skuIds: [] as string[],
    receiptIds: [] as string[],
    lineIds: [] as string[],
    planId: '' as string,
    planItemIds: [] as string[],
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WmsModule],
    }).compile();

    module = moduleRef;
    service = module.get(InboundService);
    dbService = module.get(DbService);

    // Clean DB state before tests
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

    // ensure minimal fixtures
    await dbService.db
      .insert(wmsTables.holders)
      .values({ id: '00000000-0000-0000-0000-000000000000', name: 'Default Holder', isOurAsset: true } as any)
      // @ts-ignore onConflict typing
      .onConflictDoNothing({ target: wmsTables.holders.id });

    // create warehouse
    const [wh] = await dbService.db
      .insert(wmsTables.warehouses)
      .values({ name: 'UNIT-WH', type: 'domestic', location: 'Seoul' } as any)
      .returning();
    created.warehouseId = wh.id;

    // ensure system inbound location exists (create if missing)
    let sysInbound = await dbService.db.query.locations.findFirst({
      where: and(
        eq(wmsTables.locations.warehouseId, created.warehouseId),
        eq(wmsTables.locations.systemRole as any, 'inbound_default' as any),
      ),
    });
    if (!sysInbound) {
      const [loc] = await dbService.db.insert(wmsTables.locations).values({
        warehouseId: created.warehouseId,
        code: 'SYS-INBOUND',
        locationType: 'zone',
        isSystem: true,
        systemRole: 'inbound_default',
        displayName: 'System Inbound Zone',
      } as any).returning();
      sysInbound = loc as any;
    }
    created.locationIds.push(sysInbound!.id);

    // create two SKUs
    const [sku1] = await dbService.db.insert(wmsTables.skus).values({ name: 'UNIT-SKU-1', code: 'UNIT-SKU-1' } as any).returning();
    const [sku2] = await dbService.db.insert(wmsTables.skus).values({ name: 'UNIT-SKU-2', code: 'UNIT-SKU-2' } as any).returning();
    created.skuIds.push(sku1.id, sku2.id);
  });

  afterAll(async () => {
    // keep DB state for inspection; just close module
    await module.close();
  });

  it('should simple inbound and create receipt/line/work log', async () => {
    const res = await service.simpleInbound({
      warehouseId: created.warehouseId,
      items: [
        { skuId: created.skuIds[0], quantity: 5, memo: 'M1' },
        { skuId: created.skuIds[1], quantity: 3, memo: 'M2' },
      ],
    });
    expect(res.success).toBe(true);
    expect(res.receiptId).toBeTruthy();
    created.receiptIds.push(res.receiptId);

    const lines = await dbService.db.query.inboundReceiptLines.findMany({
      where: eq(wmsTables.inboundReceiptLines.receiptId, res.receiptId),
    });
    expect(lines.length).toBe(2);
    // line memo should be saved
    const memos = lines.map((l:any) => l.memo);
    expect(memos).toEqual(expect.arrayContaining(['M1','M2']));
    created.lineIds.push(...lines.map(l => l.id));

    const logs = await dbService.db.query.inboundWorkLogs.findMany({
      where: eq(wmsTables.inboundWorkLogs.receiptId, res.receiptId),
    });
    expect(logs.some(l => (l as any).type === 'INBOUND')).toBe(true);
  });

  it('should putaway from origin and decrease origin available', async () => {
    // create a destination zone location in same warehouse
    const [zone] = await dbService.db.insert(wmsTables.locations).values({
      warehouseId: created.warehouseId,
      code: 'UNIT-ZONE-1',
      locationType: 'zone',
      isSystem: false,
      displayName: 'Unit Zone',
    } as any).returning();
    created.locationIds.push(zone.id);

    const lineIdPutaway = created.lineIds[0];
    const before = await dbService.db.query.inboundReceiptLines.findFirst({ where: eq(wmsTables.inboundReceiptLines.id, lineIdPutaway) });
    await service.putawayFromOrigin({ lineId: lineIdPutaway, toLocationId: zone.id, quantity: 2 });
    const after = await dbService.db.query.inboundReceiptLines.findFirst({ where: eq(wmsTables.inboundReceiptLines.id, lineIdPutaway) });
    expect((after!.putawayFromOriginQty as any) - (before!.putawayFromOriginQty as any)).toBe(2);
  });

  it('should enforce cancel rules: putaway/return blocks; partial cancel rejected; full cancel succeeds when clean', async () => {
    const lineIdPutaway = created.lineIds[0];
    const lineIdUntouched = created.lineIds[1];

    // putaway 라인: 회송/취소 실패(400)
    await expect(service.returnInbound({ lineId: lineIdPutaway, quantity: 1 })).rejects.toThrow();
    await expect(service.cancelInbound({ lineId: lineIdPutaway, quantity: 1 })).rejects.toThrow();

    // untouched 라인: 부분 취소는 거부, 전량 취소는 허용
    const untouchedBefore = await dbService.db.query.inboundReceiptLines.findFirst({ where: eq(wmsTables.inboundReceiptLines.id, lineIdUntouched) });
    const fullQty = (untouchedBefore!.quantity as any) as number;
    await expect(service.cancelInbound({ lineId: lineIdUntouched, quantity: 1 })).rejects.toThrow();
    await service.cancelInbound({ lineId: lineIdUntouched, quantity: fullQty });
    const untouchedAfter = await dbService.db.query.inboundReceiptLines.findFirst({ where: eq(wmsTables.inboundReceiptLines.id, lineIdUntouched) });
    expect((untouchedAfter!.canceledQty as any)).toBe(fullQty);
  });

  it('should allow return on a fresh line and then forbid cancel afterwards', async () => {
    // 새 간편입고로 라인 생성
    const res = await service.simpleInbound({
      warehouseId: created.warehouseId,
      items: [ { skuId: created.skuIds[0], quantity: 2 } ],
    });
    const [line] = await dbService.db.query.inboundReceiptLines.findMany({ where: eq(wmsTables.inboundReceiptLines.receiptId, res.receiptId as any) });
    // return 성공
    await service.returnInbound({ lineId: line.id, quantity: 1 });
    // return 이후 cancel 금지
    await expect(service.cancelInbound({ lineId: line.id, quantity: 2 })).rejects.toThrow();
  });

  it('should individual inbound with memo and create receipt line', async () => {
    const res = await service.individualInbound({
      warehouseId: created.warehouseId,
      skuId: created.skuIds[0],
      quantity: 2,
      memo: 'IND-MEMO',
    });
    expect(res.success).toBe(true);
    const line = await dbService.db.query.inboundReceiptLines.findFirst({
      where: eq(wmsTables.inboundReceiptLines.receiptId, res.receiptId as any),
    });
    expect((line as any).memo).toBe('IND-MEMO');
  });

  it('should create simple fullscan receipt with method tag', async () => {
    const res = await service.simpleInboundFullscan({
      warehouseId: created.warehouseId,
      items: [ { skuId: created.skuIds[0], quantity: 1 } ],
    });
    expect(res.success).toBe(true);
    const receipt = await dbService.db.query.inboundReceipts.findFirst({
      where: eq(wmsTables.inboundReceipts.id, res.receiptId as any),
    });
    expect((receipt as any).method).toBe('simple_fullscan');
  });

  it('should create inbound plan, add items, list and receive from plan', async () => {
    const plan = await service.createInboundPlan({ expectedDate: new Date().toISOString().slice(0,10), warehouseId: created.warehouseId });
    created.planId = (plan as any).id;
    await service.addInboundPlanItems({ planId: created.planId, items: [
      { skuId: created.skuIds[0], expectedQty: 4 },
    ]});

    const list = await service.listInboundPlanItems({ warehouseId: created.warehouseId });
    expect(list.items.length).toBeGreaterThan(0);
    created.planItemIds.push(...list.items.map((i:any) => i.planItemId));

    await service.receiveFromPlan({ planItemId: created.planItemIds[0], quantity: 4 });
    const items = await service.listInboundPlanItems({ warehouseId: created.warehouseId });
    const item = items.items.find((x:any) => x.planItemId === created.planItemIds[0]);
    expect(item?.receivedQty).toBe(4);
    expect(item?.status).toBe('confirmed');
  });
});


