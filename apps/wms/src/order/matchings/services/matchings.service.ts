import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../../../database/schemas/wms-schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { UpsertMatchingDto } from '../dto/upsert-matching.dto';

@Injectable()
export class MatchingsService {
  private readonly logger = new Logger(MatchingsService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.dbService.db.transaction(fn);
  }

  async getByVariant(variantId: string, tx?: DbTx) {
    return await this.inTx(async (tx) => {
      const matching = await tx.query.productMatchings.findFirst({ where: (m, { eq }) => eq(m.variantId, variantId) });
      if (!matching) return null;
      const links = await tx.query.productVariantSkuLinks.findMany({
        where: (l, { eq }) => eq(l.productMatchingId, matching.id),
      });
      return { ...matching, links };
    }, tx);
  }

  async upsert(variantId: string, dto: UpsertMatchingDto, tx?: DbTx) {
    return this.inTx(async (trx) => {
      if (!variantId) throw new BadRequestException('variantId required');

      const existing = await trx.query.productMatchings.findFirst({ where: (m, { eq }) => eq(m.variantId, variantId) });
      const base = {
        variantId: variantId,
        masterId: dto.masterId ?? null,
        status: 'matched' as const,
        priority: 'normal' as const,
        strategy: 'variant' as const,
        isResolved: true,
        inventoryManagement: dto.policy?.inventoryManagement ?? false,
        preStockSellable: dto.policy?.preStockSellable ?? true,
        alwaysSellableZeroStock: dto.policy?.alwaysSellableZeroStock ?? false,
      };
      let matchingId: string;
      if (existing) {
        const [row] = await trx
          .update(wmsTables.productMatchings)
          .set(base)
          .where(eq(wmsTables.productMatchings.variantId, variantId))
          .returning();
        matchingId = row.id;
        // 기존 링크 제거 후 재작성(간단화)
        await trx
          .delete(wmsTables.productVariantSkuLinks)
          .where(eq(wmsTables.productVariantSkuLinks.productMatchingId, matchingId));
      } else {
        const [row] = await trx.insert(wmsTables.productMatchings).values(base).returning();
        matchingId = row.id;
      }
      if (Array.isArray(dto.links) && dto.links.length > 0) {
        await trx.insert(wmsTables.productVariantSkuLinks).values(
          dto.links.map((l) => ({
            productMatchingId: matchingId,
            skuId: l.skuId,
            quantity: Math.max(1, l.quantity),
          })),
        );
      }

      // Update related sales_order_lines to reflect the new/updated matching immediately
      await trx
        .update(wmsTables.salesOrderLines)
        .set({ productMatchingId: matchingId })
        .where(eq(wmsTables.salesOrderLines.variantId, variantId));

      return this.getByVariant(variantId, trx);
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

      const statsMap = results.reduce(
        (acc, stat) => {
          if (stat.masterId) {
            acc[stat.masterId] = {
              totalVariants: stat.totalVariants,
              matchedVariants: stat.matchedVariants,
              pendingVariants: stat.pendingVariants,
              ignoredVariants: stat.ignoredVariants,
              matchingRate: stat.totalVariants > 0 ? Math.round((stat.matchedVariants / stat.totalVariants) * 100) : 0,
            };
          }
          return acc;
        },
        {} as Record<
          string,
          {
            totalVariants: number;
            matchedVariants: number;
            pendingVariants: number;
            ignoredVariants: number;
            matchingRate: number;
          }
        >,
      );

      return masterIds.map((masterId) => ({
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
