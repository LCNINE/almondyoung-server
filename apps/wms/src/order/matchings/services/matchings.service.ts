import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../../../database/schemas/wms-schema';
import { eq, inArray, sql } from 'drizzle-orm';

@Injectable()
export class MatchingsService {
  private readonly logger = new Logger(MatchingsService.name);

  constructor(private readonly db: DbService<typeof wmsSchema>) { }

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

      const existing = await trx.query.productMatchings.findFirst({ where: (m, { eq }) => eq(m.variantId, dto.variantId) });
      const base = {
        variantId: dto.variantId,
        masterId: dto.masterId || null,
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

      // Update related sales_order_lines to reflect the new/updated matching immediately
      await trx
        .update(wmsTables.salesOrderLines)
        .set({ productMatchingId: matchingId })
        .where(eq(wmsTables.salesOrderLines.variantId, dto.variantId));

      return this.getByVariant(dto.variantId, trx);
    }, tx);
  }

  async getMastersBatchStats(masterIds: string[], tx?: DbTx) {
    return this.inTx(async (trx) => {
      if (!masterIds || masterIds.length === 0) {
        return [];
      }

      const results = await trx
        .select({
          masterId: wmsTables.productMatchings.masterId,
          totalVariants: sql<number>`count(*)::int`,
          matchedVariants: sql<number>`count(*) FILTER (WHERE ${wmsTables.productMatchings.isResolved} = true)::int`,
          pendingVariants: sql<number>`count(*) FILTER (WHERE ${wmsTables.productMatchings.status} = 'pending')::int`,
          ignoredVariants: sql<number>`count(*) FILTER (WHERE ${wmsTables.productMatchings.status} = 'ignored')::int`,
        })
        .from(wmsTables.productMatchings)
        .where(inArray(wmsTables.productMatchings.masterId, masterIds))
        .groupBy(wmsTables.productMatchings.masterId);

      const statsMap = results.reduce((acc, stat) => {
        if (stat.masterId) {
          acc[stat.masterId] = {
            totalVariants: stat.totalVariants,
            matchedVariants: stat.matchedVariants,
            pendingVariants: stat.pendingVariants,
            ignoredVariants: stat.ignoredVariants,
            matchingRate: stat.totalVariants > 0
              ? Math.round((stat.matchedVariants / stat.totalVariants) * 100)
              : 0,
          };
        }
        return acc;
      }, {} as Record<string, any>);

      return masterIds.map(masterId => ({
        masterId,
        ...(statsMap[masterId] || {
          totalVariants: 0,
          matchedVariants: 0,
          pendingVariants: 0,
          ignoredVariants: 0,
          matchingRate: 0,
        }),
      }));
    }, tx);
  }
}


