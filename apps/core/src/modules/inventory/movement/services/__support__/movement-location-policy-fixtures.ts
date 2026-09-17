import { randomUUID } from 'crypto';
import { eq, asc } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../schema/inventory.schema';
import { MovementService } from '../movement.service';
import { InventoryIdempotencyService } from '../../../core/services/inventory-idempotency.service';
import { InboundReceiptKernel } from '../../../inbound/kernel/inbound-receipt.kernel';
import {
  wireLogistics,
  seedWarehouseWithZone,
  seedHolder,
  seedSku,
  receiveStock,
} from '../../../../fulfillment/services/__support__';
import { ambientDbService } from '../../../../fulfillment/services/__support__/simple-outbound-wiring';

export const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_WAREHOUSE_DEMO_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_WAREHOUSE_DEMO_DB requires an explicit DATABASE_URL');
}
export const describeIfDb = DATABASE_URL ? describe : describe.skip;

export function wiringFor(tx: DbTx) {
  const service = ambientDbService(tx);
  const wiring = wireLogistics(service);
  return {
    ...wiring,
    movement: new MovementService(service, wiring.eventStore, new InventoryIdempotencyService(service)),
    kernel: new InboundReceiptKernel(wiring.command, wiring.location, wiring.eventStore),
  };
}

export async function seed(tx: DbTx) {
  const f = await seedWarehouseWithZone(tx);
  const { holderId } = await seedHolder(tx);
  const { skuId } = await seedSku(tx, holderId);
  const wiring = wiringFor(tx);
  await receiveStock(wiring.command, tx, { ...f, skuId, quantity: 5 });
  const [dest] = await tx
    .insert(wmsTables.locations)
    .values({
      warehouseId: f.warehouseId,
      code: `dest-${randomUUID()}`,
      locationType: 'zone',
      isActive: false,
    })
    .returning();
  return { ...f, holderId, skuId, dest, wiring };
}

export async function snapshot(tx: DbTx, f: { skuId: string; warehouseId: string }) {
  return {
    ledgers: await tx
      .select()
      .from(wmsTables.stockLedgers)
      .where(eq(wmsTables.stockLedgers.skuId, f.skuId))
      .orderBy(asc(wmsTables.stockLedgers.locationId)),
    events: await tx
      .select()
      .from(wmsTables.stockEvents)
      .where(eq(wmsTables.stockEvents.skuId, f.skuId))
      .orderBy(asc(wmsTables.stockEvents.id)),
    jobs: await tx
      .select()
      .from(wmsTables.movementJobs)
      .where(eq(wmsTables.movementJobs.warehouseId, f.warehouseId))
      .orderBy(asc(wmsTables.movementJobs.id)),
    logs: await tx
      .select()
      .from(wmsTables.movementWorkLogs)
      .where(eq(wmsTables.movementWorkLogs.warehouseId, f.warehouseId))
      .orderBy(asc(wmsTables.movementWorkLogs.id)),
  };
}

export function request(f: Awaited<ReturnType<typeof seed>>, quantity = 5) {
  return {
    warehouseId: f.warehouseId,
    idempotencyKey: randomUUID(),
    lines: [
      {
        skuId: f.skuId,
        fromLocationId: f.locationId,
        toLocationId: f.dest.id,
        quantity,
      },
    ],
  };
}
