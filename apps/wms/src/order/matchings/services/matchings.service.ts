import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../../../database/schemas/wms-schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class MatchingsService {
  private readonly logger = new Logger(MatchingsService.name);
  
  constructor(private readonly db: DbService<typeof wmsSchema>) {}

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.db.transaction(fn);
  }

  async getByVariant(variantId: string, tx?: DbTx) {
    const db = tx ?? this.db.db;
    const matching = await db.query.productMatchings.findFirst({ where: (m, { eq }) => eq(m.variantId, variantId) });
    if (!matching) return null;
    const links = await db.query.productVariantSkuLinks.findMany({ where: (l, { eq }) => eq(l.productMatchingId, matching.id) });
    return { ...matching, links };
  }

  async upsert(dto: { variantId: string; masterId?: string | null; links: Array<{ skuId: string; quantity: number }>; policy?: Partial<{ inventoryManagement: boolean; preStockSellable: boolean; alwaysSellableZeroStock: boolean; }> }, tx?: DbTx) {
    return this.inTx(async (trx) => {
      if (!dto.variantId) throw new BadRequestException('variantId required');
      
      if (dto.masterId) {
        this.logger.warn(`masterId is deprecated and will be ignored. Use skuGroupId instead.`);
      }
      
      const existing = await trx.query.productMatchings.findFirst({ where: (m, { eq }) => eq(m.variantId, dto.variantId) });
      const base = {
        variantId: dto.variantId,
        status: 'matched' as any,
        priority: 'normal' as any,
        strategy: 'variant' as any,
        isResolved: true,
        inventoryManagement: dto.policy?.inventoryManagement ?? false,
        preStockSellable: dto.policy?.preStockSellable ?? true,
        alwaysSellableZeroStock: dto.policy?.alwaysSellableZeroStock ?? false,
      };
      let matchingId: string;
      if (existing) {
        const [row] = await trx.update(wmsTables.productMatchings).set(base).where(eq(wmsTables.productMatchings.variantId, dto.variantId)).returning();
        matchingId = row.id;
        // 기존 링크 제거 후 재작성(간단화)
        await trx.delete(wmsTables.productVariantSkuLinks).where(eq(wmsTables.productVariantSkuLinks.productMatchingId, matchingId));
      } else {
        const [row] = await trx.insert(wmsTables.productMatchings).values(base).returning();
        matchingId = row.id;
      }
      if (Array.isArray(dto.links) && dto.links.length > 0) {
        await trx.insert(wmsTables.productVariantSkuLinks).values(
          dto.links.map(l => ({ productMatchingId: matchingId, skuId: l.skuId, quantity: Math.max(1, l.quantity | 0) })),
        );
      }
      return this.getByVariant(dto.variantId, trx);
    }, tx);
  }
}


