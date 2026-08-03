import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { eq, inArray, and } from 'drizzle-orm';
import {
  productOptionValues,
  productOptionGroups,
  productVariants,
  productMasterVersions,
  productMasterOptionGroups,
  productMasterVariants,
  pimSchema,
} from '../../schema/catalog.schema';
import { DbTransaction } from '../../catalog.types';
import {
  ValidatedPricingRulesSet,
  pricingRulesSetSchema,
  hasWithOptionScope,
  hasVariantsScope,
  PricingRuleInput,
} from './dto';
import { PricingCalculatorService } from './pricing-calculator.service';

@Injectable()
export class PricingValidatorService {
  private readonly logger = new Logger(PricingValidatorService.name);

  constructor(
    @InjectTypedDb<typeof pimSchema>()
    private readonly dbService: DbService<typeof pimSchema>,
    private readonly calculatorService: PricingCalculatorService,
  ) {}

  async validateRuleSet(
    masterId: string,
    versionId: string,
    rulesDto: unknown,
    tx?: DbTransaction,
  ): Promise<ValidatedPricingRulesSet> {
    return this.dbService.run(async (trx) => {
      const parseResult = pricingRulesSetSchema.safeParse(rulesDto);
      if (!parseResult.success) {
        throw new BadRequestException({
          message: 'Invalid pricing rules structure',
          errors: parseResult.error.issues,
        });
      }

      const validatedRules = await this.dropStaleVariantTargets(versionId, parseResult.data, trx);

      await this.validateScopeTargets(masterId, versionId, validatedRules, trx);
      await this.validateBasePriceCoverage(versionId, validatedRules, trx);

      return validatedRules;
    }, tx);
  }

  private async validateScopeTargets(
    masterId: string,
    versionId: string,
    rulesSet: ValidatedPricingRulesSet,
    tx: DbTransaction,
  ): Promise<void> {
    const allRules = this.collectAllRules(rulesSet);

    const withOptionTargetIds = this.collectTargetIds(allRules, hasWithOptionScope);
    if (withOptionTargetIds.length > 0) {
      await this.validateOptionValueIds(masterId, versionId, withOptionTargetIds, tx);
    }

    const variantsTargetIds = this.collectTargetIds(allRules, hasVariantsScope);
    if (variantsTargetIds.length > 0) {
      await this.validateVariantIds(masterId, versionId, variantsTargetIds, tx);
    }
  }

  /**
   * 이 버전에 없는 variant 를 가리키는 타깃을 걸러낸다.
   * 버전이 바뀔 때 룰의 scopeTargetIds 가 새 variant 로 따라가지 않아 옛 id 가 남는 경우가 있고
   * 그대로 두면 validateScopeTargets 가 "Variant IDs not found" 로 저장을 막는다.
   * 유령 id 는 계산기가 어차피 매칭하지 않으므로 제거해도 가격은 변하지 않는다.
   * 남는 타깃이 없어진 룰은 아무 variant 에도 적용되지 않으므로 룰째로 뺀다.
   */
  private async dropStaleVariantTargets(
    versionId: string,
    rulesSet: ValidatedPricingRulesSet,
    tx: DbTransaction,
  ): Promise<ValidatedPricingRulesSet> {
    const variants = await tx
      .select({ id: productMasterVariants.variantId })
      .from(productMasterVariants)
      .where(eq(productMasterVariants.versionId, versionId));
    const live = new Set(variants.map((v) => v.id));

    let dropped = 0;
    const clean = (rules: PricingRuleInput[]): PricingRuleInput[] =>
      rules.flatMap((rule) => {
        if (rule.scopeType !== 'variants' || !rule.scopeTargetIds) return [rule];

        const kept = rule.scopeTargetIds.filter((id) => live.has(id));
        if (kept.length === rule.scopeTargetIds.length) return [rule];

        dropped += rule.scopeTargetIds.length - kept.length;
        return kept.length > 0 ? [{ ...rule, scopeTargetIds: kept }] : [];
      });

    const cleaned = {
      basePriceRules: clean(rulesSet.basePriceRules),
      membershipPriceRules: clean(rulesSet.membershipPriceRules),
      tieredPriceRules: clean(rulesSet.tieredPriceRules),
    };

    if (dropped > 0) {
      this.logger.warn(`version ${versionId}: 이 버전에 없는 variant 타깃 ${dropped}개를 룰에서 제거했습니다`);
    }

    return cleaned;
  }

  /**
   * 모든 variant 가 base_price 룰에 하나 이상 걸리는지 확인한다.
   * 안 걸리면 계산기가 0 원을 내고 (pricing-calculator: currentPrice 는 0 에서 시작) 0원 상품이 게시된다.
   */
  private async validateBasePriceCoverage(
    versionId: string,
    rulesSet: ValidatedPricingRulesSet,
    tx: DbTransaction,
  ): Promise<void> {
    const variants = await tx
      .select({ id: productMasterVariants.variantId })
      .from(productMasterVariants)
      .where(eq(productMasterVariants.versionId, versionId));

    const uncovered: string[] = [];
    for (const variant of variants) {
      const matches = await Promise.all(
        rulesSet.basePriceRules.map((rule) => this.calculatorService.matchesScope(variant.id, rule, tx)),
      );
      if (!matches.some(Boolean)) {
        uncovered.push(variant.id);
      }
    }

    if (uncovered.length > 0) {
      const sample = uncovered.slice(0, 5).join(', ');
      const suffix = uncovered.length > 5 ? ` 외 ${uncovered.length - 5}개` : '';
      throw new BadRequestException(
        `판매가 규칙이 적용되지 않는 옵션이 ${uncovered.length}개 있습니다 (0원으로 게시됩니다): ${sample}${suffix}`,
      );
    }
  }

  private collectAllRules(rulesSet: ValidatedPricingRulesSet): PricingRuleInput[] {
    return [...rulesSet.basePriceRules, ...rulesSet.membershipPriceRules, ...rulesSet.tieredPriceRules];
  }

  private collectTargetIds(rules: PricingRuleInput[], scopeGuard: (rule: PricingRuleInput) => boolean): string[] {
    const targetIds = rules.filter(scopeGuard).flatMap((rule) => rule.scopeTargetIds || []);

    return [...new Set(targetIds)];
  }

  private async validateOptionValueIds(
    masterId: string,
    versionId: string,
    optionValueIds: string[],
    tx: DbTransaction,
  ): Promise<void> {
    const optionValues = await tx
      .select({
        id: productOptionValues.id,
        masterId: productMasterOptionGroups.masterId,
      })
      .from(productOptionValues)
      .innerJoin(productOptionGroups, eq(productOptionValues.optionGroupId, productOptionGroups.id))
      .innerJoin(productMasterOptionGroups, eq(productOptionGroups.id, productMasterOptionGroups.optionGroupId))
      .where(
        and(
          eq(productMasterOptionGroups.masterId, masterId),
          eq(productMasterOptionGroups.versionId, versionId),
          inArray(productOptionValues.id, optionValueIds),
        ),
      );

    this.validateFoundIds(
      optionValueIds,
      optionValues.map((ov) => ov.id),
      'Option value IDs not found',
    );

    this.validateMasterId(
      masterId,
      optionValues,
      (ov) => ov.masterId,
      (ov) => ov.id,
      'Option values do not belong to master',
    );
  }

  private async validateVariantIds(
    masterId: string,
    versionId: string,
    variantIds: string[],
    tx: DbTransaction,
  ): Promise<void> {
    const variants = await tx
      .select({
        id: productVariants.id,
        masterId: productMasterVariants.masterId,
      })
      .from(productVariants)
      .innerJoin(productMasterVariants, eq(productVariants.id, productMasterVariants.variantId))
      .where(
        and(
          eq(productMasterVariants.masterId, masterId),
          eq(productMasterVariants.versionId, versionId),
          inArray(productVariants.id, variantIds),
        ),
      );

    this.validateFoundIds(
      variantIds,
      variants.map((v) => v.id),
      'Variant IDs not found',
    );

    this.validateMasterId(
      masterId,
      variants,
      (v) => v.masterId,
      (v) => v.id,
      'Variants do not belong to master',
    );
  }

  private validateFoundIds(requestedIds: string[], foundIds: string[], errorMessagePrefix: string): void {
    const foundSet = new Set(foundIds);
    const missingIds = requestedIds.filter((id) => !foundSet.has(id));

    if (missingIds.length > 0) {
      throw new BadRequestException(`${errorMessagePrefix}: ${missingIds.join(', ')}`);
    }
  }

  private validateMasterId<T>(
    expectedMasterId: string,
    items: T[],
    getMasterId: (item: T) => string,
    getId: (item: T) => string,
    errorMessagePrefix: string,
  ): void {
    const invalidItems = items.filter((item) => getMasterId(item) !== expectedMasterId);

    if (invalidItems.length > 0) {
      const invalidIds = invalidItems.map(getId).join(', ');
      throw new BadRequestException(`${errorMessagePrefix} ${expectedMasterId}: ${invalidIds}`);
    }
  }

  async validateCalculatedPrices(versionId: string, tx?: DbTransaction): Promise<void> {
    return this.dbService.run(async (trx) => {
      const variants = await trx
        .select({ id: productVariants.id })
        .from(productMasterVariants)
        .innerJoin(productVariants, eq(productMasterVariants.variantId, productVariants.id))
        .where(and(eq(productMasterVariants.versionId, versionId)));

      if (variants.length === 0) {
        return;
      }

      const errors: string[] = [];

      for (const variant of variants) {
        try {
          const baseResult = await this.calculatorService.calculateVariantPriceByVersion(
            versionId,
            variant.id,
            undefined,
            'regular',
            trx,
          );

          if (baseResult.price < 0) {
            errors.push(`Variant ${variant.id}: base price is ${baseResult.price} (must be >= 0)`);
          }

          const membershipResult = await this.calculatorService.calculateVariantPriceByVersion(
            versionId,
            variant.id,
            undefined,
            'membership',
            trx,
          );

          if (membershipResult.price < 0) {
            errors.push(`Variant ${variant.id}: membership price is ${membershipResult.price} (must be >= 0)`);
          }
        } catch (error) {
          errors.push(`Variant ${variant.id}: price calculation failed - ${error.message}`);
        }
      }

      if (errors.length > 0) {
        throw new BadRequestException({
          message: 'Invalid calculated prices: \n' + errors.join('\n'),
        });
      }
    }, tx);
  }
}
