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
import { OutboxService as InventoryOutboxService } from '../../../shared/outbox/outbox.service';
import { InboundService } from '../inbound.service';

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

export function makeInboundService(database: Database): InboundService {
  const dbService = dbServiceFor(database);
  const guard = new BatchControlledStockGuard();
  const outbox = new InventoryOutboxService(dbService);
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
  return new InboundService(dbService, skuCatalog as never, command, location, eventStore, idempotency);
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
