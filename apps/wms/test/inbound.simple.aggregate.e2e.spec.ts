import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { WmsModule } from '../src/wms.module';
import { DbService } from '@app/db';
import { wmsTables } from '../database/schemas/wms-schema';
import { and, eq, sql } from 'drizzle-orm';

describe('Inbound Simple Aggregate Flow (e2e)', () => {
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

    // DB는 테스트 훅에서 템플릿으로 초기화됩니다. 별도 TRUNCATE/홀더 보장은 필요 없습니다.
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it('should accumulate quantities across multiple simple inbound operations', async () => {
    // 1) Create warehouse
    const whRes = await request(httpServer)
      .post('/wms/inventory/warehouses')
      .send({ name: 'AGG-테스트창고', type: 'domestic', location: 'Seoul' })
      .expect(201);
    const warehouseId = whRes.body.id as string;

    // Ensure system inbound location exists and get its id
    const sysInbound = await dbService.db.query.locations.findFirst({
      where: and(
        eq(wmsTables.locations.warehouseId, warehouseId),
        eq(wmsTables.locations.systemRole as any, 'inbound_default' as any),
      ),
    });
    expect(sysInbound?.id).toBeTruthy();

    // 2) Create SKUs
    const skuIds: string[] = [];
    for (const name of ['AGG-SKU-1', 'AGG-SKU-2']) {
      const skuRes = await request(httpServer)
        .post('/wms/inventory/skus')
        .send({ name })
        .expect(201);
      skuIds.push(skuRes.body.id);
    }

    // SKU 레벨에서 inventoryManagement를 더 이상 검증하지 않습니다.

    // 3) Perform multiple simple inbound operations
    // Call #1 (no locationId -> fallback to system inbound)
    await request(httpServer)
      .post('/wms/inbound/simple')
      .send({
        warehouseId,
        items: [
          { skuId: skuIds[0], quantity: 5 },
          { skuId: skuIds[1], quantity: 3 },
        ],
      })
      .expect(201);

    // Call #2 (no locationId -> fallback to same system inbound)
    await request(httpServer)
      .post('/wms/inbound/simple')
      .send({
        warehouseId,
        items: [
          { skuId: skuIds[0], quantity: 2 },
          { skuId: skuIds[1], quantity: 7 },
        ],
      })
      .expect(201);

    // Call #3 (explicitly specify system inbound locationId)
    await request(httpServer)
      .post('/wms/inbound/simple')
      .send({
        warehouseId,
        locationId: sysInbound!.id,
        items: [
          { skuId: skuIds[0], quantity: 4 },
          { skuId: skuIds[1], quantity: 1 },
        ],
      })
      .expect(201);

    // 4) Validate events: 3 calls x 2 items = 6 RECEIVE events to same warehouse
    const events = await dbService.db.query.stockEvents.findMany({
      where: and(
        eq(wmsTables.stockEvents.toWarehouseId, warehouseId),
        eq(wmsTables.stockEvents.transitionType as any, 'RECEIVE' as any),
      ),
    });
    expect(events.length).toBe(6);
    // All events should be to system inbound location
    const uniqueToLocationIds = Array.from(
      new Set(events.map((e) => (e as any).toLocationId)),
    );
    expect(uniqueToLocationIds).toEqual([sysInbound!.id]);

    // 5) Validate ledgers aggregated on same grain (SKU x warehouse x location x state)
    // Totals: sku1 = 5+2+4 = 11, sku2 = 3+7+1 = 11
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
    expect(ledgersSku1?.qty).toBe(11);
    expect(ledgersSku2?.qty).toBe(11);
  }, 60000);
});


