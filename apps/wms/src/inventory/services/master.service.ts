import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb, TypedDatabase, DbService } from '@app/db';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { OptionEngineService, OptionSchema } from '@app/shared/option-engine/option-engine.service';
import { InventoryService } from './inventory.service';
import { and, eq } from 'drizzle-orm';

type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsTables>['transaction']>[0]>[0];

@Injectable()
export class MasterService {
  private readonly logger = new Logger(MasterService.name);

  constructor(
    @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
    private readonly optionEngine: OptionEngineService,
    private readonly inventoryService: InventoryService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async createMaster(params: {
    name: string;
    masterCode: string;
    purpose?: 'standard' | 'set' | 'material';
    optionSchema?: OptionSchema;
    defaultPolicy?: Record<string, unknown>;
  }, tx?: DbTx) {
    return this.inTx(async (trx) => {
      if (params.optionSchema) {
        this.optionEngine.validateSchema(params.optionSchema);
      }
      const [master] = await trx.insert(wmsTables.inventoryProductMasters).values({
        name: params.name,
        masterCode: params.masterCode,
        purpose: (params.purpose ?? 'standard') as any,
        optionSchema: params.optionSchema as any,
        defaultPolicy: params.defaultPolicy as any,
      }).returning();
      return master;
    }, tx);
  }

  async updateMaster(masterId: string, params: Partial<{
    name: string;
    purpose: 'standard' | 'set' | 'material';
    optionSchema: OptionSchema;
    defaultPolicy: Record<string, unknown>;
    status: 'active' | 'archived';
  }>, tx?: DbTx) {
    return this.inTx(async (trx) => {
      if (params.optionSchema) this.optionEngine.validateSchema(params.optionSchema);
      const [updated] = await trx.update(wmsTables.inventoryProductMasters)
        .set({
          name: params.name,
          purpose: params.purpose as any,
          optionSchema: params.optionSchema as any,
          defaultPolicy: params.defaultPolicy as any,
          status: params.status as any,
        })
        .where(eq(wmsTables.inventoryProductMasters.id, masterId))
        .returning();
      return updated;
    }, tx);
  }

  async deleteMaster(masterId: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      await trx.delete(wmsTables.inventoryMasterSkuLinks).where(eq(wmsTables.inventoryMasterSkuLinks.masterId, masterId));
      await trx.delete(wmsTables.inventoryProductMasters).where(eq(wmsTables.inventoryProductMasters.id, masterId));
    }, tx);
  }

  async generateSkusFromOptions(masterId: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const master = await trx.query.inventoryProductMasters.findFirst({ where: eq(wmsTables.inventoryProductMasters.id, masterId) });
      if (!master) return [];
      const schema = (master.optionSchema || { options: [] }) as OptionSchema;
      const combos = this.optionEngine.generateCombinations(schema);

      const createdSkuIds: string[] = [];
      for (const combo of combos) {
        const existing = await trx.query.inventoryMasterSkuLinks.findFirst({ where: and(eq(wmsTables.inventoryMasterSkuLinks.masterId, masterId), eq(wmsTables.inventoryMasterSkuLinks.optionKey, combo as any)) });
        // naive existence check by optionKey json string match is omitted for simplicity
        if (existing) continue;
        const sku = await this.inventoryService.createSku({ name: `${master.name} ${Object.values(combo).join(' / ')}` as any }, trx as any);
        await trx.insert(wmsTables.inventoryMasterSkuLinks).values({
          masterId,
          skuId: sku.id,
          optionKey: combo as any,
          isPrimary: false,
        });
        createdSkuIds.push(sku.id);
      }
      return createdSkuIds;
    }, tx);
  }
}


