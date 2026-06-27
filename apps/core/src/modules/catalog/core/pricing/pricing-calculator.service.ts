import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { eq, and, asc, SQL } from 'drizzle-orm';
import {
  pricingRules,
  productMasterPricingRules,
  productMasterVersions,
  productVariants,
  productMasterVariants,
  variantOptionValues,
  pimSchema,
} from '../../schema/catalog.schema';
import {
  DbTransaction,
  PriceCalculationResult,
  AppliedRuleInfo,
  ScopeType,
  OperationType,
  VariantPriceSet,
  TieredPriceInfo,
} from '../../catalog.types';
import { PricingRuleEntity } from '../../schema/catalog.schema.types';

@Injectable()
export class PricingCalculatorService {
  constructor(
    @InjectTypedDb<typeof pimSchema>()
    private readonly dbService: DbService<typeof pimSchema>,
  ) {}

  async calculateVariantPriceByVersion(
    versionId: string,
    variantId: string,
    quantity?: number,
    customerType: 'regular' | 'membership' = 'regular',
    tx?: DbTransaction,
  ): Promise<PriceCalculationResult> {
    return this.dbService.run(async (trx) => {
      const [version] = await trx
        .select({
          masterId: productMasterVersions.masterId,
          version: productMasterVersions.version,
        })
        .from(productMasterVersions)
        .where(eq(productMasterVersions.id, versionId));

      if (!version) {
        throw new NotFoundException(`Product version ${versionId} not found`);
      }

      const [mapping] = await trx
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, version.masterId),
            eq(productMasterVariants.versionId, versionId),
            eq(productMasterVariants.variantId, variantId),
          ),
        );

      if (!mapping) {
        throw new BadRequestException(`Variant ${variantId} is not part of version ${versionId}`);
      }

      const rules = await this.getRulesForVersion(versionId, undefined, trx);

      let currentPrice = 0;
      const appliedRules: AppliedRuleInfo[] = [];
      const breakdown = {
        initialPrice: 0,
        afterBasePrice: 0,
        afterMembershipPrice: undefined as number | undefined,
        afterTieredPrice: undefined as number | undefined,
      };

      for (const rule of rules.basePriceRules) {
        if (await this.matchesScope(variantId, rule, trx)) {
          const priceBeforeRule = currentPrice;
          currentPrice = this.applyRule(currentPrice, rule);
          appliedRules.push({
            ruleId: rule.id,
            layer: 'base_price',
            order: rule.order,
            scopeType: rule.scopeType as ScopeType,
            operationType: rule.operationType as OperationType,
            operationValue: rule.operationValue,
            priceBeforeRule,
            priceAfterRule: currentPrice,
          });
        }
      }
      breakdown.afterBasePrice = currentPrice;

      if (customerType === 'membership') {
        for (const rule of rules.membershipPriceRules) {
          if (await this.matchesScope(variantId, rule, trx)) {
            const priceBeforeRule = currentPrice;
            currentPrice = this.applyRule(currentPrice, rule);
            appliedRules.push({
              ruleId: rule.id,
              layer: 'membership_price',
              order: rule.order,
              scopeType: rule.scopeType as ScopeType,
              operationType: rule.operationType as OperationType,
              operationValue: rule.operationValue,
              priceBeforeRule,
              priceAfterRule: currentPrice,
            });
          }
        }
        breakdown.afterMembershipPrice = currentPrice;
      }

      if (customerType === 'membership' && quantity && quantity > 0) {
        let bestTieredRule: (typeof rules.tieredPriceRules)[0] | null = null;

        for (const rule of rules.tieredPriceRules) {
          if (rule.minQuantity && rule.minQuantity <= quantity && (await this.matchesScope(variantId, rule, trx))) {
            if (!bestTieredRule || !bestTieredRule.minQuantity || rule.minQuantity > bestTieredRule.minQuantity) {
              bestTieredRule = rule;
            }
          }
        }

        if (bestTieredRule) {
          const priceBeforeRule = currentPrice;
          currentPrice = this.applyRule(currentPrice, bestTieredRule);
          appliedRules.push({
            ruleId: bestTieredRule.id,
            layer: 'tiered_price',
            order: bestTieredRule.order,
            scopeType: bestTieredRule.scopeType as ScopeType,
            operationType: bestTieredRule.operationType as OperationType,
            operationValue: bestTieredRule.operationValue,
            priceBeforeRule,
            priceAfterRule: currentPrice,
          });
        }

        breakdown.afterTieredPrice = currentPrice;
      }

      const finalPrice = Math.max(0, currentPrice);

      return {
        variantId,
        price: finalPrice,
        totalPrice: quantity ? finalPrice * quantity : undefined,
        appliedRules,
        priceBreakdown: breakdown,
      };
    }, tx);
  }

  async calculateVariantPriceSet(versionId: string, variantId: string, tx?: DbTransaction): Promise<VariantPriceSet> {
    return this.dbService.run(async (trx) => {
      const [version] = await trx
        .select({
          masterId: productMasterVersions.masterId,
          version: productMasterVersions.version,
        })
        .from(productMasterVersions)
        .where(eq(productMasterVersions.id, versionId));

      if (!version) {
        throw new NotFoundException(`Product version ${versionId} not found`);
      }

      const [mapping] = await trx
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, version.masterId),
            eq(productMasterVariants.versionId, versionId),
            eq(productMasterVariants.variantId, variantId),
          ),
        );

      if (!mapping) {
        throw new BadRequestException(`Variant ${variantId} is not part of version ${versionId}`);
      }

      const baseResult = await this.calculateVariantPriceByVersion(versionId, variantId, 1, 'regular', trx);

      const membershipResult = await this.calculateVariantPriceByVersion(versionId, variantId, 1, 'membership', trx);

      const rules = await this.getRulesForVersion(versionId, 'tiered_price', trx);

      const tieredPrices: TieredPriceInfo[] = [];
      const processedQuantities = new Set<number>();

      for (const rule of rules.tieredPriceRules) {
        if (
          rule.minQuantity &&
          !processedQuantities.has(rule.minQuantity) &&
          (await this.matchesScope(variantId, rule, trx))
        ) {
          const tierResult = await this.calculateVariantPriceByVersion(
            versionId,
            variantId,
            rule.minQuantity,
            'membership',
            trx,
          );

          tieredPrices.push({
            minQuantity: rule.minQuantity,
            price: tierResult.price,
          });

          processedQuantities.add(rule.minQuantity);
        }
      }

      tieredPrices.sort((a, b) => a.minQuantity - b.minQuantity);

      return {
        basePrice: baseResult.price,
        membershipPrice: membershipResult.price,
        tieredPrices,
      };
    }, tx);
  }

  async calculateVariantPriceSetMany(
    versionId: string,
    variantIds: string[],
    tx?: DbTransaction,
  ): Promise<VariantPriceSet[]> {
    return this.dbService.run(async (trx) => {
      const [version] = await trx
        .select({ masterId: productMasterVersions.masterId })
        .from(productMasterVersions)
        .where(eq(productMasterVersions.id, versionId));

      if (!version) {
        throw new NotFoundException(`Product version ${versionId} not found`);
      }

      const mappings = await trx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, version.masterId),
            eq(productMasterVariants.versionId, versionId),
          ),
        );

      const validVariantIds = new Set(mappings.map((m) => m.variantId));
      const rules = await this.getRulesForVersion(versionId, undefined, trx);

      const results: VariantPriceSet[] = [];

      for (const variantId of variantIds) {
        if (!validVariantIds.has(variantId)) {
          continue;
        }

        const baseResult = await this.calculateVariantPriceByVersion(versionId, variantId, 1, 'regular', trx);
        const membershipResult = await this.calculateVariantPriceByVersion(versionId, variantId, 1, 'membership', trx);

        const tieredPrices: TieredPriceInfo[] = [];
        const processedQuantities = new Set<number>();

        for (const rule of rules.tieredPriceRules) {
          if (
            rule.minQuantity &&
            !processedQuantities.has(rule.minQuantity) &&
            (await this.matchesScope(variantId, rule, trx))
          ) {
            const tierResult = await this.calculateVariantPriceByVersion(
              versionId,
              variantId,
              rule.minQuantity,
              'membership',
              trx,
            );
            tieredPrices.push({ minQuantity: rule.minQuantity, price: tierResult.price });
            processedQuantities.add(rule.minQuantity);
          }
        }

        tieredPrices.sort((a, b) => a.minQuantity - b.minQuantity);
        results.push({ basePrice: baseResult.price, membershipPrice: membershipResult.price, tieredPrices });
      }

      return results;
    }, tx);
  }

  applyRule(currentPrice: number, rule: PricingRuleEntity): number {
    switch (rule.operationType) {
      case 'offset':
        return currentPrice + rule.operationValue;
      case 'scale':
        return Math.ceil((currentPrice * (1000 + rule.operationValue)) / 1000);
      case 'override':
        return rule.operationValue;
      default:
        return currentPrice;
    }
  }

  async getRulesForVersion(
    versionId: string,
    layer?: 'base_price' | 'membership_price' | 'tiered_price',
    tx?: DbTransaction,
  ): Promise<{
    basePriceRules: PricingRuleEntity[];
    membershipPriceRules: PricingRuleEntity[];
    tieredPriceRules: PricingRuleEntity[];
  }> {
    return this.dbService.run(async (trx) => {
      const conditions: SQL[] = [eq(productMasterPricingRules.versionId, versionId)];

      if (layer) {
        conditions.push(eq(pricingRules.layer, layer));
      }

      const allRules: PricingRuleEntity[] = await trx
        .select({
          id: pricingRules.id,
          layer: pricingRules.layer,
          order: pricingRules.order,
          scopeType: pricingRules.scopeType,
          scopeTargetIds: pricingRules.scopeTargetIds,
          operationType: pricingRules.operationType,
          operationValue: pricingRules.operationValue,
          minQuantity: pricingRules.minQuantity,
          createdAt: pricingRules.createdAt,
          updatedAt: pricingRules.updatedAt,
        })
        .from(pricingRules)
        .innerJoin(productMasterPricingRules, eq(pricingRules.id, productMasterPricingRules.pricingRuleId))
        .where(and(...conditions))
        .orderBy(asc(pricingRules.order));

      return {
        basePriceRules: allRules.filter((r) => r.layer === 'base_price'),
        membershipPriceRules: allRules.filter((r) => r.layer === 'membership_price'),
        tieredPriceRules: allRules.filter((r) => r.layer === 'tiered_price'),
      };
    }, tx);
  }

  async matchesScope(variantId: string, rule: PricingRuleEntity, tx?: DbTransaction): Promise<boolean> {
    return this.dbService.run(async (trx) => {
      switch (rule.scopeType) {
        case 'all_variants':
          return true;

        case 'with_option': {
          if (!rule.scopeTargetIds || rule.scopeTargetIds.length === 0) {
            return false;
          }
          const variantOptions = await trx
            .select({ optionValueId: variantOptionValues.optionValueId })
            .from(variantOptionValues)
            .where(eq(variantOptionValues.variantId, variantId));

          const variantOptionValueIds = variantOptions.map((vo) => vo.optionValueId);
          return rule.scopeTargetIds.some((targetId) => variantOptionValueIds.includes(targetId));
        }

        case 'variants': {
          if (!rule.scopeTargetIds || rule.scopeTargetIds.length === 0) {
            return false;
          }
          return rule.scopeTargetIds.includes(variantId);
        }

        default:
          return false;
      }
    }, tx);
  }
}
