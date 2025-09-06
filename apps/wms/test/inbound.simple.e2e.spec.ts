import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { WmsModule } from '../src/wms.module';
import { DbService } from '@app/db';
import { wmsTables } from '../database/schemas/wms-schema';
import { and, eq, sql } from 'drizzle-orm';

describe('Inbound Simple Flow (e2e)', () => {
  let app: INestApplication;
  let httpServer: any;
  let dbService: DbService<typeof wmsTables>;

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

    // Ensure default holder row exists for FK (skus.holder_id references holders.id)
    await dbService.db
      .insert(wmsTables.holders)
      .values({
        id: '00000000-0000-0000-0000-000000000000',
        name: 'Default Holder',
        isOurAsset: true,
      } as any)
      // @ts-ignore drizzle onConflictDoNothing typing may vary
      .onConflictDoNothing({ target: wmsTables.holders.id });
  }, 30000);

  afterAll(async () => {
    await dbService.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL client_min_messages TO warning`);
      await tx.execute(sql`TRUNCATE TABLE
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

  it('should create warehouse, create skus, simple inbound, and verify DB state', async () => {
    const whRes = await request(httpServer)
      .post('/wms/inventory/warehouses')
      .send({ name: 'E2E-테스트창고', type: 'domestic', location: 'Seoul' })
      .expect(201);
    const warehouseId = whRes.body.id as string;

    const wh = await dbService.db.query.warehouses.findFirst({
      where: eq(wmsTables.warehouses.id, warehouseId),
    });
    expect(wh).toBeTruthy();

    const skuIds: string[] = [];
    for (const name of ['E2E-SKU-1', 'E2E-SKU-2']) {
      const skuRes = await request(httpServer)
        .post('/wms/inventory/skus')
        .send({ name })
        .expect(201);
      skuIds.push(skuRes.body.id);
    }

    // SKU 레벨에서 inventoryManagement를 더 이상 검증하지 않습니다.

    const inboundRes = await request(httpServer)
      .post('/wms/inbound/simple')
      .send({
        warehouseId,
        items: [
          { skuId: skuIds[0], quantity: 5 },
          { skuId: skuIds[1], quantity: 3 },
        ],
      })
      .expect(201);
    expect(inboundRes.body.success).toBe(true);

    const sysInbound = await dbService.db.query.locations.findFirst({
      where: and(
        eq(wmsTables.locations.warehouseId, warehouseId),
        eq(wmsTables.locations.systemRole as any, 'inbound_default' as any),
      ),
    });
    expect(sysInbound?.id).toBeTruthy();

    const events = await dbService.db.query.stockEvents.findMany({
      where: and(
        eq(wmsTables.stockEvents.toWarehouseId, warehouseId),
        eq(wmsTables.stockEvents.transitionType as any, 'RECEIVE' as any),
      ),
    });
    expect(events.length).toBe(2);

    const ledgersSku1 = await dbService.db.query.stockLedgers.findFirst({
      where: and(
        eq(wmsTables.stockLedgers.skuId, skuIds[0]),
        eq(wmsTables.stockLedgers.warehouseId, warehouseId),
        eq(wmsTables.stockLedgers.locationId, sysInbound!.id),
        eq(wmsTables.stockLedgers.stockState as any, 'ON_HAND' as any),
      ),
    });
    const ledgersSku2 = await dbService.db.query.stockLedgers.findFirst({
      where: and(
        eq(wmsTables.stockLedgers.skuId, skuIds[1]),
        eq(wmsTables.stockLedgers.warehouseId, warehouseId),
        eq(wmsTables.stockLedgers.locationId, sysInbound!.id),
        eq(wmsTables.stockLedgers.stockState as any, 'ON_HAND' as any),
      ),
    });
    expect(ledgersSku1?.qty).toBe(5);
    expect(ledgersSku2?.qty).toBe(3);
  }, 45000);
});


