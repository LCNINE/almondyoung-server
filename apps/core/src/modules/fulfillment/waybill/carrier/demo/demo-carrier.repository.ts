import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { inventorySchema, inventoryTables } from '../../../../inventory/schema/inventory.schema';
import type { DemoCarrierStore, DemoCarrierStoredRecord } from './demo-carrier.gateway';

@Injectable()
export class DemoCarrierRepository implements DemoCarrierStore {
  constructor(@InjectTypedDb<typeof inventorySchema>() private readonly dbService: DbService<typeof inventorySchema>) {}

  async allocate(input: {
    requestKey: string;
    requestHash: string;
    waybillNo: string;
    labelData: Record<string, unknown>;
  }): Promise<DemoCarrierStoredRecord> {
    return this.dbService.run(async (trx) => {
      await trx.insert(inventoryTables.demoCarrierShipments).values(input).onConflictDoNothing();
      const [record] = await trx
        .select()
        .from(inventoryTables.demoCarrierShipments)
        .where(eq(inventoryTables.demoCarrierShipments.requestKey, input.requestKey));
      if (!record) throw new Error(`Demo carrier allocation was not persisted: ${input.requestKey}`);
      return record;
    });
  }

  async register(waybillNo: string): Promise<'registered' | 'already_registered' | 'canceled' | 'missing'> {
    return this.dbService.run(async (trx) => {
      const changed = await trx
        .update(inventoryTables.demoCarrierShipments)
        .set({ status: 'registered', registeredAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(inventoryTables.demoCarrierShipments.waybillNo, waybillNo),
            eq(inventoryTables.demoCarrierShipments.status, 'allocated'),
          ),
        )
        .returning({ waybillNo: inventoryTables.demoCarrierShipments.waybillNo });
      if (changed.length > 0) return 'registered';
      const [record] = await trx
        .select({ status: inventoryTables.demoCarrierShipments.status })
        .from(inventoryTables.demoCarrierShipments)
        .where(eq(inventoryTables.demoCarrierShipments.waybillNo, waybillNo));
      if (!record) return 'missing';
      if (record.status === 'registered') return 'already_registered';
      return 'canceled';
    });
  }

  async cancel(waybillNo: string): Promise<boolean> {
    return this.dbService.run(async (trx) => {
      const changed = await trx
        .update(inventoryTables.demoCarrierShipments)
        .set({ status: 'canceled', canceledAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(inventoryTables.demoCarrierShipments.waybillNo, waybillNo),
            inArray(inventoryTables.demoCarrierShipments.status, ['allocated', 'registered']),
          ),
        )
        .returning({ waybillNo: inventoryTables.demoCarrierShipments.waybillNo });
      if (changed.length > 0) return true;
      const [record] = await trx
        .select({ waybillNo: inventoryTables.demoCarrierShipments.waybillNo })
        .from(inventoryTables.demoCarrierShipments)
        .where(eq(inventoryTables.demoCarrierShipments.waybillNo, waybillNo));
      return Boolean(record);
    });
  }

  async track(waybillNo: string): Promise<{ status: string; updatedAt: Date } | null> {
    return this.dbService.run(async (trx) => {
      const [record] = await trx
        .select({
          status: inventoryTables.demoCarrierShipments.status,
          updatedAt: inventoryTables.demoCarrierShipments.updatedAt,
        })
        .from(inventoryTables.demoCarrierShipments)
        .where(eq(inventoryTables.demoCarrierShipments.waybillNo, waybillNo));
      return record ?? null;
    });
  }
}
