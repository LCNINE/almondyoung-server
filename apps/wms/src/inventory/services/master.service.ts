import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb, TypedDatabase, DbService } from '@app/db';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { OptionEngineService, OptionSchema } from '@app/shared/option-engine/option-engine.service';
import { InventoryService } from './inventory.service';
import { PimOrchestrator, PimHttpClient } from '@app/shared';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';

type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsTables>['transaction']>[0]>[0];

@Injectable()
export class MasterService {
  private readonly logger = new Logger(MasterService.name);

  constructor(
    @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
    private readonly optionEngine: OptionEngineService,
    private readonly inventoryService: InventoryService,
    private readonly configService: ConfigService,
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
    // 1) 내부 저장 (트랜잭션)
    const master = await this.inTx(async (trx) => {
      if (params.optionSchema) this.optionEngine.validateSchema(params.optionSchema);
      const [created] = await trx.insert(wmsTables.inventoryProductMasters).values({
        name: params.name,
        masterCode: params.masterCode,
        purpose: (params.purpose ?? 'standard') as any,
        optionSchema: params.optionSchema as any,
        defaultPolicy: params.defaultPolicy as any,
      }).returning();
      return created;
    }, tx);

    // 2) 외부 호출 (트랜잭션 밖)
    const pimEnabled = this.configService.get('PIM_SYNC_ENABLED') === 'true';
    if (pimEnabled) {
      await this.syncWithPim(master.id);
    }

    return master;
  }

  async syncWithPim(masterId: string): Promise<{ masterId: string; variants: string[] }> {
    const pimBaseUrl = this.configService.get<string>('PIM_BASE_URL') || 'http://localhost:3001';
    const pimApiKey = this.configService.get<string>('PIM_API_KEY');
    const client = new PimHttpClient(pimBaseUrl, pimApiKey);
    const orchestrator = new PimOrchestrator(client);

    // 마스터/옵션 스키마 조회
    const master = await this.db.query.inventoryProductMasters.findFirst({ where: eq(wmsTables.inventoryProductMasters.id, masterId) });
    if (!master) {
      throw new Error(`Master not found: ${masterId}`);
    }

    const optionSchema = (master.optionSchema || { options: [] }) as OptionSchema;
    const input = {
      name: master.name,
      pricingStrategy: 'variant_based',
      basePrice: 0,
      optionGroups: (optionSchema.options || []).map(o => ({ name: o.name, values: o.values.map(v => ({ value: v, displayName: v })) })),
    };

    // PIM 마스터/변형 생성
    const { masterId: pimMasterId } = await orchestrator.createMasterAndVariants(input, { idempotencyKey: `wms-${masterId}` });
    const detail = await client.getMasterDetail(pimMasterId);
    const variantIds: string[] = Array.isArray(detail?.variants) ? detail.variants.map((v: any) => v.id) : [];

    // WMS 매칭 row 준비 (pending)
    await this.inTx(async (trx) => {
      for (const variantId of variantIds) {
        // upsert 유사: 기존 존재하면 skip
        const existing = await trx.query.productMatchings.findFirst({ where: eq(wmsTables.productMatchings.variantId, variantId) });
        if (existing) continue;
        await trx.insert(wmsTables.productMatchings).values({
          variantId,
          masterId,
          status: 'pending' as any,
          priority: 'normal' as any,
          strategy: (optionSchema.options?.length ?? 0) > 0 ? 'variant' as any : 'void' as any,
          isResolved: false,
        });
      }
    });

    return { masterId, variants: variantIds };
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


