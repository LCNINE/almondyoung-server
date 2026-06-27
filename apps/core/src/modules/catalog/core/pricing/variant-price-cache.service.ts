import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { eq, inArray, InferInsertModel, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { productMasterVersions, productMasterVariants, productVariantPriceCache, pimSchema } from '../../schema/catalog.schema';
import { DbTransaction, PriceSummary } from '../../catalog.types';
import { PricingCalculatorService } from './pricing-calculator.service';
import { NewProductVariantPriceCache } from '../../catalog.types';

type CachedPriceSet = {
  variantId: string;
  basePrice: number;
  membershipPrice: number;
  tieredPrices: Array<{ minQuantity: number; price: number }>;
};

@Injectable()
export class VariantPriceCacheService {
  constructor(
    @InjectTypedDb<typeof pimSchema>()
    private readonly dbService: DbService<typeof pimSchema>,
    private readonly calculatorService: PricingCalculatorService,
  ) {}

  async cachePricesForVersion(versionId: string, tx?: DbTransaction): Promise<number> {
    return this.dbService.run(async (trx) => {
      const [version] = await trx
        .select({ id: productMasterVersions.id })
        .from(productMasterVersions)
        .where(eq(productMasterVersions.id, versionId));

      if (!version) {
        throw new NotFoundException(`Product version ${versionId} not found`);
      }

      const variants = await trx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(eq(productMasterVariants.versionId, versionId));

      if (variants.length === 0) {
        return 0;
      }

      const rows: NewProductVariantPriceCache[] = [];
      for (const { variantId } of variants) {
        const priceSet = await this.calculatorService.calculateVariantPriceSet(versionId, variantId, trx);

        rows.push({
          id: uuidv7(),
          versionId,
          variantId,
          basePrice: priceSet.basePrice,
          membershipPrice: priceSet.membershipPrice,
          tieredPrices: priceSet.tieredPrices,
          createdAt: new Date(),
        });
      }

      await trx
        .insert(productVariantPriceCache)
        .values(rows)
        .onConflictDoUpdate({
          target: [productVariantPriceCache.versionId, productVariantPriceCache.variantId],
          set: {
            basePrice: sql`excluded.base_price`,
            membershipPrice: sql`excluded.membership_price`,
            tieredPrices: sql`excluded.tiered_prices`,
            createdAt: sql`excluded.created_at`,
          },
        });

      return rows.length;
    }, tx);
  }

  async getCachedPriceSetsByVersion(versionId: string, tx?: DbTransaction): Promise<CachedPriceSet[]> {
    return this.dbService.run(async (trx) => {
      return trx
        .select({
          variantId: productVariantPriceCache.variantId,
          basePrice: productVariantPriceCache.basePrice,
          membershipPrice: productVariantPriceCache.membershipPrice,
          tieredPrices: productVariantPriceCache.tieredPrices,
        })
        .from(productVariantPriceCache)
        .where(eq(productVariantPriceCache.versionId, versionId));
    }, tx);
  }

  async getPriceSummariesByVersionIds(versionIds: string[], tx?: DbTransaction): Promise<Map<string, PriceSummary>> {
    return this.dbService.run(async (trx) => {
      if (versionIds.length === 0) {
        return new Map();
      }

      const rows = await trx
        .select({
          versionId: productVariantPriceCache.versionId,
          minBasePrice: sql<number>`min(${productVariantPriceCache.basePrice})::int4`,
          maxBasePrice: sql<number>`max(${productVariantPriceCache.basePrice})::int4`,
          minMembershipPrice: sql<number>`min(${productVariantPriceCache.membershipPrice})::int4`,
          maxMembershipPrice: sql<number>`max(${productVariantPriceCache.membershipPrice})::int4`,
          hasTieredPrices: sql<number>`
            max(
              case
                when jsonb_array_length(${productVariantPriceCache.tieredPrices}) > 0 then 1
                else 0
              end
            )
          `,
        })
        .from(productVariantPriceCache)
        .where(inArray(productVariantPriceCache.versionId, versionIds))
        .groupBy(productVariantPriceCache.versionId);

      return new Map(
        rows.map((row) => [
          row.versionId,
          {
            minBasePrice: row.minBasePrice,
            maxBasePrice: row.maxBasePrice,
            minMembershipPrice: row.minMembershipPrice,
            maxMembershipPrice: row.maxMembershipPrice,
            hasTieredPrices: row.hasTieredPrices === 1,
          },
        ]),
      );
    }, tx);
  }
}
