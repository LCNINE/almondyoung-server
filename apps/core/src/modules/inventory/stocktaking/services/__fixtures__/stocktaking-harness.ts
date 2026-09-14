import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { wmsSchema, wmsTables } from '../../../schema/inventory.schema';
import { dbServiceFor, makeInventoryCommandService } from '../../../inbound/services/__fixtures__/inbound-harness';
import { InventoryIdempotencyService } from '../../../core/services/inventory-idempotency.service';
import { StocktakingController } from '../../controllers/stocktaking.controller';
import { StocktakingService } from '../stocktaking.service';

export function stocktakingHarness(url: string) {
  const sql = postgres(url, { max: 5 });
  const db = drizzle(sql, { schema: wmsSchema });
  const command = makeInventoryCommandService(db);
  const service = new StocktakingService(dbServiceFor(db), command);
  const controller = new StocktakingController(service, new InventoryIdempotencyService(dbServiceFor(db)));
  const actor = { id: randomUUID() };
  async function seed(quantity = 5) {
    const suffix = randomUUID();
    const [warehouse] = await db
      .insert(wmsTables.warehouses)
      .values({ name: `count-${suffix}` })
      .returning();
    const [holder] = await db
      .insert(wmsTables.holders)
      .values({ name: `count-${suffix}` })
      .returning();
    const [sku] = await db
      .insert(wmsTables.skus)
      .values({ name: 'count', code: `COUNT-${suffix}`, holderId: holder.id })
      .returning();
    const [location] = await db
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: `COUNT-${suffix}`, locationType: 'zone' })
      .returning();
    const [otherLocation] = await db
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: `OTHER-${suffix}`, locationType: 'zone' })
      .returning();
    const barcode = `COUNT-${suffix}`;
    await db.insert(wmsTables.skuBarcodes).values({ skuId: sku.id, barcode, isPrimary: true });
    const [session] = await db
      .insert(wmsTables.stocktakingSessions)
      .values({ warehouseId: warehouse.id, sessionName: 'count', status: 'in_progress' })
      .returning();
    const stockInput = { skuId: sku.id, warehouseId: warehouse.id, locationId: location.id, reason: 'test fixture' };
    if (quantity) await command.adjustUp({ ...stockInput, quantity });
    const scan = {
      sessionId: session.id,
      locationId: location.id,
      productBarcode: barcode,
      contractVersion: 2,
      idempotencyKey: randomUUID(),
      quantity: 1,
    };
    return { warehouse, sku, location, otherLocation, session, stockInput, scan };
  }
  return { sql, db, command, service, controller, actor, seed };
}
