import { drizzle } from 'drizzle-orm/postgres-js';
import * as postgres from 'postgres';
import { ConfigService } from '@nestjs/config';
import { DbTx, wmsSchema } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import {
  makeDbService,
  wireLogistics,
} from '../../../apps/core/src/modules/fulfillment/services/__support__/logistics-wiring';
import { InboundService } from '../../../apps/core/src/modules/inventory/inbound/services/inbound.service';
import { SkuCatalogService } from '../../../apps/core/src/modules/inventory/sku-catalog/services/sku-catalog.service';
import { SkuCatalogReader } from '../../../apps/core/src/modules/inventory/sku-catalog/services/sku-catalog.reader';
import { SkuCatalogManager } from '../../../apps/core/src/modules/inventory/sku-catalog/services/sku-catalog.manager';
import { InventoryIdempotencyService } from '../../../apps/core/src/modules/inventory/core/services/inventory-idempotency.service';
import { AuditService } from '../../../apps/core/src/modules/inventory/shared/services/audit.service';
import { FulfillmentCommandService } from '../../../apps/core/src/modules/fulfillment/services/fulfillment-command.service';
import { FulfillmentInvariantService } from '../../../apps/core/src/modules/fulfillment/services/fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from '../../../apps/core/src/modules/fulfillment/services/fulfillment-workflow-gate.service';
import { ShipmentPlanningService } from '../../../apps/core/src/modules/fulfillment/services/shipment-planning.service';
import { FULFILLMENT_SCOPES } from '../../../apps/core/src/platform/auth/fulfillment-scopes';
import { recreateDatabase, resolveSeedUrl, runCoreMigrations } from './database';
import { bootstrapScopes } from './scopes';
import { seedMasterData } from './master-data';
import { seedStock } from './stock';
import { seedInbound } from './inbound';
import { seedOrders } from './orders';
import { planShipments } from './shipments';
import { seedBulk } from './bulk';

async function main(): Promise<void> {
  const bulk = process.argv.includes('--bulk');
  const url = resolveSeedUrl();

  console.log(`── 1/4 dev_core 재생성 (${url})`);
  await recreateDatabase(url);

  console.log('── 2/4 drizzle 마이그레이션');
  runCoreMigrations(url);

  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema: wmsSchema });

  try {
    console.log('── 3/4 스코프 부트스트랩');
    await bootstrapScopes(db);

    console.log(`── 4/4 시드${bulk ? ' (--bulk)' : ''}`);
    const dbService = makeDbService(db);
    const wired = wireLogistics(dbService, 'v2');

    // InboundService 는 Nest DI 없이도 손으로 조립 가능한 정도(협력자 5개, 전부 dbService 하나만
    // 필요)라 여기서 직접 생성한다 — wireLogistics 가 이미 command/location/eventStore 를 만들어
    // 두었으니 SkuCatalogService·InventoryIdempotencyService 만 추가로 조립하면 된다.
    const skuCatalogReader = new SkuCatalogReader(dbService);
    const skuCatalogManager = new SkuCatalogManager(dbService, skuCatalogReader);
    const skuCatalogService = new SkuCatalogService(skuCatalogReader, skuCatalogManager);
    const idempotency = new InventoryIdempotencyService(dbService);
    const inboundService = new InboundService(
      dbService,
      skuCatalogService,
      wired.command,
      wired.location,
      wired.eventStore,
      idempotency,
    );

    // ShipmentPlanningService 는 wireLogistics 의 Wired 밖이라 (다른 BC 조합에서는 안 쓰이는
    // 협력자라) 여기서 직접 조립한다.
    const planning = new ShipmentPlanningService(
      dbService,
      new FulfillmentCommandService(dbService),
      wired.shipmentReservations,
      new FulfillmentInvariantService(),
      new AuditService(dbService),
      // plan() 경로는 scope 를 보지 않지만 생성자가 요구한다. 시드 액터는 master 이므로
      // 전 scope 를 가진 stub 으로 채운다 (통합 스펙과 동일한 관용구).
      { getScopesByRoles: () => Promise.resolve(new Set(FULFILLMENT_SCOPES.map((scope) => scope.key))) } as never,
      new FulfillmentWorkflowGate(
        new ConfigService({
          FULFILLMENT_WORKFLOW_MODE: 'v2',
          FULFILLMENT_V2_CUTOVER_AT: '1970-01-01T00:00:00.000Z',
        }),
      ),
    );

    await db.transaction(async (trx) => {
      // db 가 typed schema(PostgresJsDatabase<typeof wmsSchema>)로 열려 있어 trx 도 구조적으로
      // DbTx 와 호환되지만, drizzle 의 transaction 콜백 제네릭이 이를 그대로 추론해주지 않는다.
      // logistics-wiring.ts 의 makeDbService 와 동일한 관용구로 좁혀준다.
      const tx = trx as unknown as DbTx;
      await seedMasterData(tx);
      await seedStock(wired.command, tx);
      await seedInbound(inboundService, tx);
      const shipmentIds = await seedOrders(wired, tx);
      await planShipments(planning, shipmentIds, tx);

      if (bulk) {
        await seedBulk(tx);
      }
    });
  } finally {
    await client.end();
  }

  console.log('✅ dev_core 리셋 완료');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
