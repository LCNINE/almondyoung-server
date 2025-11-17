import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { eq, and, asc, SQL } from 'drizzle-orm';
import { 
  pricingRules,
  productMasterPricingRules,
  productMasters,
  productVariants,
  productMasterVariants,
  variantOptionValues,
  pimSchema 
} from '../../schema';
import { 
  DbTransaction, 
  PricingRule,
  PriceCalculationResult,
  AppliedRuleInfo,
  ScopeType,
  OperationType
} from '../../types';

@Injectable()
export class PricingCalculatorService {
  constructor(
    @InjectTypedDb<typeof pimSchema>()
    private readonly dbService: DbService<typeof pimSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(
    fn: (tx: DbTransaction) => Promise<T>,
    tx?: DbTransaction,
  ): Promise<T> {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async calculateVariantPrice(
    masterId: string,
    variantId: string,
    quantity?: number,
    customerType: 'regular' | 'membership' = 'regular',
    tx?: DbTransaction,
  ): Promise<PriceCalculationResult> {
    return this.inTx(async (trx) => {
      const rules = await this.getRulesForMaster(masterId, undefined, trx);
      
      let currentPrice = 0;
      const appliedRules: AppliedRuleInfo[] = [];
      const breakdown = {
        initialPrice: 0,
        afterBasePrice: 0,
        afterMembershipPrice: undefined as number | undefined,
        afterTieredPrice: undefined as number | undefined,
      };

      // Layer 1: base_price (항상 적용)
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

      // Layer 2: membership_price (customerType === 'membership'만)
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

      // Layer 3: tiered_price (customerType === 'membership' && quantity)
      if (customerType === 'membership' && quantity && quantity > 0) {
        for (const rule of rules.tieredPriceRules) {
          if (
            rule.minQuantity &&
            rule.minQuantity <= quantity &&
            (await this.matchesScope(variantId, rule, trx))
          ) {
            const priceBeforeRule = currentPrice;
            currentPrice = this.applyRule(currentPrice, rule);
            appliedRules.push({
              ruleId: rule.id,
              layer: 'tiered_price',
              order: rule.order,
              scopeType: rule.scopeType as ScopeType,
              operationType: rule.operationType as OperationType,
              operationValue: rule.operationValue,
              priceBeforeRule,
              priceAfterRule: currentPrice,
            });
          }
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

  async calculateAllVariantsPrices(
    masterId: string,
    tx?: DbTransaction,
  ): Promise<Map<string, { basePrice: number; membershipPrice: number }>> {
    return this.inTx(async (trx) => {
      // 매핑 테이블을 통해 active 버전의 variants 조회
      const variants = await trx
        .select({ id: productVariants.id })
        .from(productMasterVariants)
        .innerJoin(
          productVariants,
          eq(productMasterVariants.variantId, productVariants.id),
        )
        .innerJoin(
          productMasters,
          and(
            eq(productMasterVariants.masterId, productMasters.masterId),
            eq(productMasterVariants.version, productMasters.version),
            eq(productMasters.versionStatus, 'active'),
          ),
        )
        .where(eq(productMasters.masterId, masterId));

      const priceMap = new Map<
        string,
        { basePrice: number; membershipPrice: number }
      >();

      for (const variant of variants) {
        const baseResult = await this.calculateVariantPrice(
          masterId,
          variant.id,
          undefined,
          'regular',
          trx,
        );
        const membershipResult = await this.calculateVariantPrice(
          masterId,
          variant.id,
          undefined,
          'membership',
          trx,
        );

        priceMap.set(variant.id, {
          basePrice: baseResult.price,
          membershipPrice: membershipResult.price,
        });
      }

      return priceMap;
    }, tx);
  }

  applyRule(currentPrice: number, rule: PricingRule): number {
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

  async getRulesForMaster(
    masterId: string,
    layer?: 'base_price' | 'membership_price' | 'tiered_price',
    tx?: DbTransaction,
    version?: number,
  ): Promise<{
    basePriceRules: PricingRule[];
    membershipPriceRules: PricingRule[];
    tieredPriceRules: PricingRule[];
  }> {
    return this.inTx(async (trx) => {
      type RuleRow = {
        id: string;
        layer: string;
        order: number;
        scopeType: string;
        scopeTargetIds: string[] | null;
        operationType: string;
        operationValue: number;
        minQuantity: number | null;
        createdAt: Date | null;
        updatedAt: Date | null;
      };

      let allRules: RuleRow[];

      // version이 지정되면 해당 버전만, 아니면 active 버전 사용
      if (version !== undefined) {
        const conditions: SQL[] = [
          eq(productMasterPricingRules.masterId, masterId),
          eq(productMasterPricingRules.version, version),
        ];

        if (layer) {
          conditions.push(eq(pricingRules.layer, layer));
        }

        allRules = await trx
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
          .innerJoin(
            productMasterPricingRules,
            eq(pricingRules.id, productMasterPricingRules.pricingRuleId),
          )
          .where(and(...conditions))
          .orderBy(asc(pricingRules.order));
      } else {
        // active 버전의 rules 가져오기
        const conditions: SQL[] = [
          eq(productMasters.masterId, masterId),
          eq(productMasters.versionStatus, 'active'),
        ];

        if (layer) {
          conditions.push(eq(pricingRules.layer, layer));
        }

        allRules = await trx
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
          .innerJoin(
            productMasterPricingRules,
            eq(pricingRules.id, productMasterPricingRules.pricingRuleId),
          )
          .innerJoin(
            productMasters,
            and(
              eq(productMasterPricingRules.masterId, productMasters.masterId),
              eq(productMasterPricingRules.version, productMasters.version),
            ),
          )
          .where(and(...conditions))
          .orderBy(asc(pricingRules.order));
      }

      return {
        basePriceRules: allRules.filter((r) => r.layer === 'base_price'),
        membershipPriceRules: allRules.filter(
          (r) => r.layer === 'membership_price',
        ),
        tieredPriceRules: allRules.filter((r) => r.layer === 'tiered_price'),
      };
    }, tx);
  }

  async matchesScope(
    variantId: string,
    rule: PricingRule,
    tx?: DbTransaction,
  ): Promise<boolean> {
    return this.inTx(async (trx) => {
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

          const variantOptionValueIds = variantOptions.map(
            (vo) => vo.optionValueId,
          );
          return rule.scopeTargetIds.some((targetId) =>
            variantOptionValueIds.includes(targetId),
          );
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

