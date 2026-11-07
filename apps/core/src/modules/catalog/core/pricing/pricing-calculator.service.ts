import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { eq, and, asc, inArray, SQL } from 'drizzle-orm';
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
} from '../../catalog.types';
import { PricingRuleEntity } from '../../schema/catalog.schema.types';
import {
  buildSaleTierPrices,
  discountedPrice,
  sortTiers,
  tiersForCombination,
  type VariantPriceBasis,
} from './quantity-discount.math';
import { QuantityDiscountReader, QuantityDiscountReadModel } from './quantity-discount.reader';

@Injectable()
export class PricingCalculatorService {
  constructor(
    @InjectTypedDb<typeof pimSchema>()
    private readonly dbService: DbService<typeof pimSchema>,
    private readonly quantityDiscounts: QuantityDiscountReader,
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

      // 수량 할인은 버전의 구간표만 본다(꺼져 있거나 없으면 구간가 없음).
      const tierQuantity = quantity ?? 0;
      const discount =
        tierQuantity > 1 ? await this.quantityDiscounts.findForVersion(version.masterId, versionId, trx) : null;
      const rateOf = (t: { regularRateBp: number; membershipRateBp: number }) =>
        customerType === 'membership' ? t.membershipRateBp : t.regularRateBp;
      const combination =
        discount && discount.variantOverrides.length > 0
          ? (await this.combinationsByVariant([variantId], trx)).get(variantId)
          : undefined;
      const tier = discount?.enabled
        ? sortTiers(tiersForCombination(discount, combination))
            .filter((t) => t.minQuantity <= tierQuantity && rateOf(t) > 0)
            .pop()
        : undefined;
      if (tier) {
        currentPrice = discountedPrice(currentPrice, rateOf(tier));
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

      const discount = await this.quantityDiscounts.findForVersion(version.masterId, versionId, trx);
      const combination =
        discount && discount.variantOverrides.length > 0
          ? (await this.combinationsByVariant([variantId], trx)).get(variantId)
          : undefined;
      return this.priceSetFor(versionId, variantId, discount, combination, trx);
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
          and(eq(productMasterVariants.masterId, version.masterId), eq(productMasterVariants.versionId, versionId)),
        );

      const validVariantIds = new Set(mappings.map((m) => m.variantId));
      const discount = await this.quantityDiscounts.findForVersion(version.masterId, versionId, trx);
      const combinations =
        discount && discount.variantOverrides.length > 0
          ? await this.combinationsByVariant([...validVariantIds], trx)
          : new Map<string, string>();

      const results: VariantPriceSet[] = [];

      for (const variantId of variantIds) {
        if (!validVariantIds.has(variantId)) {
          continue;
        }

        results.push(await this.priceSetFor(versionId, variantId, discount, combinations.get(variantId), trx));
      }

      return results;
    }, tx);
  }

  /** 구간가는 버전의 구간표로만 만든다(그 옵션의 예외가 있으면 예외). 표가 없거나 꺼져 있으면 구간가가 없다. */
  private async priceSetFor(
    versionId: string,
    variantId: string,
    discount: QuantityDiscountReadModel | null,
    combination: string | undefined,
    trx: DbTransaction,
  ): Promise<VariantPriceSet> {
    const basePrice = (await this.calculateVariantPriceByVersion(versionId, variantId, 1, 'regular', trx)).price;
    const membershipPrice = (await this.calculateVariantPriceByVersion(versionId, variantId, 1, 'membership', trx))
      .price;

    const tiers = discount?.enabled
      ? buildSaleTierPrices({ basePrice, membershipPrice, tiers: tiersForCombination(discount, combination) })
      : { regular: [], membership: [] };
    return { basePrice, membershipPrice, tieredPrices: tiers.regular, membershipTieredPrices: tiers.membership };
  }

  /** 구간표 검증의 기준이 되는 옵션별 정가·멤버십가(1개 기준). */
  async calculatePriceBasis(versionId: string, tx?: DbTransaction): Promise<VariantPriceBasis[]> {
    return this.dbService.run(async (trx) => {
      const variants = await trx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(eq(productMasterVariants.versionId, versionId));

      const combinations = await this.combinationsByVariant(
        variants.map((v) => v.variantId),
        trx,
      );
      const result: VariantPriceBasis[] = [];
      for (const { variantId } of variants) {
        const base = await this.calculateVariantPriceByVersion(versionId, variantId, 1, 'regular', trx);
        const membership = await this.calculateVariantPriceByVersion(versionId, variantId, 1, 'membership', trx);
        result.push({
          variantId,
          basePrice: base.price,
          membershipPrice: membership.price,
          combination: combinations.get(variantId) ?? '',
        });
      }
      return result;
    }, tx);
  }

  /**
   * 옵션의 조합 키 = 옵션값 id 를 정렬해 «+» 로 이은 값(엑셀 양식의 «조합» 칸과 같은 식).
   * 옵션 수정으로 variant 행이 새로 생겨도 옵션값은 같으므로 키가 바뀌지 않는다. 옵션 없는 상품은 ''.
   */
  private async combinationsByVariant(variantIds: string[], trx: DbTransaction): Promise<Map<string, string>> {
    const out = new Map<string, string>(variantIds.map((id) => [id, '']));
    if (variantIds.length === 0) return out;
    const rows = await trx
      .select({ variantId: variantOptionValues.variantId, optionValueId: variantOptionValues.optionValueId })
      .from(variantOptionValues)
      .where(inArray(variantOptionValues.variantId, variantIds));
    const grouped = new Map<string, string[]>();
    for (const row of rows) grouped.set(row.variantId, [...(grouped.get(row.variantId) ?? []), row.optionValueId]);
    for (const [variantId, ids] of grouped) out.set(variantId, [...ids].sort().join('+'));
    return out;
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
    layer?: 'base_price' | 'membership_price',
    tx?: DbTransaction,
  ): Promise<{
    basePriceRules: PricingRuleEntity[];
    membershipPriceRules: PricingRuleEntity[];
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
      };
    }, tx);
  }

  async matchesScope(
    variantId: string,
    rule: { scopeType: ScopeType; scopeTargetIds?: string[] | null },
    tx?: DbTransaction,
  ): Promise<boolean> {
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
