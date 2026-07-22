import { drizzle } from 'drizzle-orm/postgres-js';
import * as postgres from 'postgres';
import * as readline from 'readline/promises';
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
import { DEFAULT_SEED_URL, recreateDatabase, resolveSeedUrl, runCoreMigrations } from './database';
import { assertLocalDevCoreUrl } from './guard';
import { bootstrapScopes } from './scopes';
import { seedMasterData } from './master-data';
import { seedStock } from './stock';
import { seedInbound } from './inbound';
import { seedOrders } from './orders';
import { planShipments } from './shipments';
import { seedBulk } from './bulk';

/**
 * 이 스크립트의 유일한 의도된 대상은 DEFAULT_SEED_URL(localhost:5432/dev_core) 이다.
 * `sst tunnel` 이 떠 있으면 guard.ts 의 호스트/DB이름 검사를 통과하면서도 localhost 가
 * 실제로는 라이브 클러스터를 가리킬 수 있다 — 그 경우 DROP 은 원격에서 조용한 no-op 이고
 * CREATE + 마이그레이션은 라이브 클러스터에 새 DB 를 만들어버린다(아무것도 지우진 않지만 의도한
 * 격리보다 약하다). 기본값과 다른 대상일 때만 사람에게 명시적으로 되묻는다.
 *
 * 비대화식 stdin(파이프/리다이렉트/CI)에서는 프롬프트에 답할 수 없으므로 **안전 측으로
 * 즉시 거부**한다 — hang 되지 않고 바로 에러를 던진다. seed.integration.spec.ts 는
 * SEED_DEV_CORE_URL 을 DEFAULT_SEED_URL 과 똑같은 문자열로 설정해 호출하므로 이 함수가
 * 아예 이 분기를 타지 않고 즉시 리턴한다 — --runInBand 로 돌려도 멈추지 않는다.
 */
async function confirmNonDefaultTarget(url: string): Promise<void> {
  if (url === DEFAULT_SEED_URL) {
    return;
  }

  console.log('⚠️  SEED_DEV_CORE_URL 이 기본값과 다릅니다.');
  console.log(`   대상: ${url}`);
  console.log(`   기본값(이 설계가 의도하는 유일한 대상): ${DEFAULT_SEED_URL}`);
  console.log('   이 명령은 위 대상에 DROP DATABASE → CREATE DATABASE → 전체 마이그레이션을 수행합니다.');
  console.log('   sst tunnel 이 떠 있다면 이 호스트가 라이브 클러스터를 가리킬 수 있습니다 (guard.ts 참고).');

  if (!process.stdin.isTTY) {
    throw new Error(
      '[seed-dev-core] 비대화식 환경(파이프/리다이렉트/CI)에서는 기본값과 다른 대상을 확인 없이 ' +
        '진행할 수 없어 중단합니다. 인터랙티브 터미널에서 다시 실행해 프롬프트에 답하세요.',
    );
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await rl.question("정말로 위 대상에 대해 진행하려면 'yes' 를 입력하세요: ");
  } finally {
    rl.close();
  }

  if (answer.trim().toLowerCase() !== 'yes') {
    throw new Error("[seed-dev-core] 'yes' 확인을 받지 못해 중단합니다.");
  }
}

async function main(): Promise<void> {
  const bulk = process.argv.includes('--bulk');
  const url = resolveSeedUrl();
  // recreateDatabase/runCoreMigrations 도 각자 다시 검증하지만(중첩 방어), 이 스크립트가 여는
  // client 자체는 그 검증에 의존하지 않고 여기서 직접 확인한다 — 나중에 호출 순서가 바뀌어도
  // 안전하도록.
  assertLocalDevCoreUrl(url);
  await confirmNonDefaultTarget(url);

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
