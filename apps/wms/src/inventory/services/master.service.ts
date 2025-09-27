import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../../database/schemas/wms-schema';
import { OptionEngineService, OptionSchema } from '@app/shared/option-engine/option-engine.service';
import { InventoryService } from './inventory.service';
import { PimOrchestrator, PimHttpClient } from '@app/shared';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';

@Injectable()
export class MasterService {
  private readonly logger = new Logger(MasterService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
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
    optionSchema?: OptionSchema;
    defaultPolicy?: Record<string, unknown>;
  }, tx?: DbTx) {
    // 1) 내부 저장 (트랜잭션)
    const master = await this.inTx(async (trx) => {
      if (params.optionSchema) this.optionEngine.validateSchema(params.optionSchema);
      const [created] = await trx.insert(wmsTables.inventoryProductMasters).values({
        name: params.name,
        masterCode: params.masterCode,
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
    optionSchema: OptionSchema;
    defaultPolicy: Record<string, unknown>;
    status: 'active' | 'archived';
  }>, tx?: DbTx) {
    return this.inTx(async (trx) => {
      if (params.optionSchema) this.optionEngine.validateSchema(params.optionSchema);
      const [updated] = await trx.update(wmsTables.inventoryProductMasters)
        .set({
          name: params.name,
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
      // 새 모델에서는 skus.master_id FK가 있으므로 링크 테이블 정리는 선택적
      const [linkedSku] = await trx
        .select({ id: wmsTables.skus.id })
        .from(wmsTables.skus)
        .where(eq(wmsTables.skus.masterId, masterId))
        .limit(1);
      if (linkedSku) {
        throw new Error('Cannot delete master with linked SKUs');
      }
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
        // (master_id, option_key) 유니크 제약을 사용해 존재 검사
        const existing = await trx.query.skus.findFirst({ where: and(eq(wmsTables.skus.masterId, masterId), eq(wmsTables.skus.optionKey, combo as any)) });
        if (existing) continue;
        const skuName = `${master.name} ${Object.values(combo).join(' / ')}`;
        const sku = await this.inventoryService.createSku({ name: skuName, masterId, optionKey: combo as any } as any, trx);
        createdSkuIds.push(sku.id);
      }
      return createdSkuIds;
    }, tx);
  }

  async updateMasterOptions(masterId: string, optionSchema: OptionSchema, tx?: DbTx) {
    return this.inTx(async (trx) => {
      this.optionEngine.validateSchema(optionSchema);
      const [updated] = await trx.update(wmsTables.inventoryProductMasters)
        .set({ optionSchema: optionSchema as any, updatedAt: new Date() })
        .where(eq(wmsTables.inventoryProductMasters.id, masterId))
        .returning();
      return updated;
    }, tx);
  }

  async getSkusByMaster(masterId: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const rows = await trx
        .select({
          id: wmsTables.skus.id,
          name: wmsTables.skus.name,
          code: wmsTables.skus.code,
          defaultBarcode: wmsTables.skus.defaultBarcode,
          masterId: wmsTables.skus.masterId,
          optionKey: wmsTables.skus.optionKey,
          createdAt: wmsTables.skus.createdAt,
          updatedAt: wmsTables.skus.updatedAt,
        })
        .from(wmsTables.skus)
        .where(eq(wmsTables.skus.masterId, masterId));
      return rows;
    }, tx);
  }
}


