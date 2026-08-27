import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../../schema/inventory.schema';
import { StockEventStore } from '../../../core/repositories/stock-event.store';
import { LocationService } from '../../../core/services/location.service';
import { InventoryCommandService } from '../../../core/services/inventory-command.service';
import { InventoryIdempotencyService } from '../../../core/services/inventory-idempotency.service';
import { BatchControlledStockGuard } from '../../../core/services/batch-controlled-stock.guard';
import { ProductSellableQuantityService } from '../../../product-sellable-quantity/services/product-sellable-quantity.service';
import { INVENTORY_STREAM } from '@packages/event-contracts/streams';
import { outboxPublisherFor } from '../../../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { InboundService } from '../inbound.service';
import { InboundPutawayReader } from '../inbound-putaway.reader';
import { PurchaseOrderClosureAdapter } from '../../../procurement/services/purchase-order-closure.adapter';

export type Database = PostgresJsDatabase<typeof wmsSchema>;

/**
 * 통합 스펙은 Nest DI 컨테이너를 거치지 않고 서비스를 손으로 세운다(저장소 관례).
 * 조립 자체는 분기 없는 5줄인데도 실제로 드리프트한 이력이 있다 — StockEventStore
 * 와 InventoryCommandService 에 batchControlledStock 이 기본값과 함께 추가되면서
 * 어떤 스펙은 넘기고 어떤 스펙은 안 넘기게 갈렸다. 배선만 여기 모아 둔다.
 *
 * 시드 픽스처는 일부러 여기 두지 않는다 — 스펙마다 필요한 행이 달라서
 * 공유하면 과매개변수 함수가 되고 인라인보다 읽기 어려워진다.
 */
function dbServiceFor(database: Database): DbService<typeof wmsSchema> {
  return {
    db: database,
    run: (<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) =>
      tx ? fn(tx) : database.transaction((trx) => fn(trx as unknown as DbTx))) as never,
  } as unknown as DbService<typeof wmsSchema>;
}

/**
 * InboundService 조립에 필요한 하위 서비스 일체 — command(InventoryCommandService)
 * 를 스펙에서 직접 써야 할 때(예: moveInternal 로 원장을 서비스 우회 이동시켜
 * putawayFromOriginQty 와 원장을 일부러 어긋나게 하는 시나리오) 매번 손으로
 * 다시 조립하면 여기 배선이 갈라질 위험이 있다 — 한 곳에서만 만든다.
 */
function buildWiring(database: Database) {
  const dbService = dbServiceFor(database);
  const guard = new BatchControlledStockGuard();
  const outbox = outboxPublisherFor(INVENTORY_STREAM, dbService);
  const sellable = new ProductSellableQuantityService(dbService as never, outbox);
  const eventStore = new StockEventStore(dbService, sellable, guard);
  const location = new LocationService(dbService);
  const command = new InventoryCommandService(dbService, eventStore, outbox, location, guard);
  const idempotency = new InventoryIdempotencyService(dbService);
  // individualInbound 경로만 skuCatalogService.findById 를 부른다. 전체 카탈로그
  // 서비스를 조립할 필요는 없어서 그 한 메서드만 스텁으로 세운다.
  const skuCatalog = {
    findById: (skuId: string, tx?: DbTx) =>
      (tx ?? database).query.skus.findFirst({ where: eq(wmsTables.skus.id, skuId) }),
  };
  return { dbService, guard, outbox, sellable, eventStore, location, command, idempotency, skuCatalog };
}

export function makeInboundService(database: Database): InboundService {
  const { dbService, skuCatalog, command, location, eventStore, idempotency } = buildWiring(database);
  return new InboundService(
    dbService,
    skuCatalog as never,
    command,
    location,
    eventStore,
    idempotency,
    new PurchaseOrderClosureAdapter(),
  );
}

export function makeInboundPutawayReader(database: Database): InboundPutawayReader {
  return new InboundPutawayReader(dbServiceFor(database));
}

/**
 * `InboundService.putawayFromOrigin` 을 거치지 않고 원장만 이동시키고 싶을 때
 * 쓴다 — "적치 대신 이동 화면으로 옮겼다" 시나리오 재현용. `InboundService` 가
 * 내부에서 쓰는 것과 같은 배선(buildWiring)에서 뽑으므로 두 서비스가 서로 다른
 * dbService/이벤트스토어를 보는 일이 없다.
 */
export function makeInventoryCommandService(database: Database): InventoryCommandService {
  return buildWiring(database).command;
}

class Rollback extends Error {}

/** 커밋 없이 검증한다 — 통합 스펙이 dev DB 를 더럽히지 않게. */
export async function inRollbackTx(database: Database, fn: (tx: DbTx) => Promise<void>): Promise<void> {
  await expect(
    database.transaction(async (trx) => {
      await fn(trx as unknown as DbTx);
      throw new Rollback('intentional rollback');
    }),
  ).rejects.toThrow(Rollback);
}
