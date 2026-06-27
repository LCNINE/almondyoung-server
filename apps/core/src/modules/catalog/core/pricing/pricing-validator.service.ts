import { Injectable, BadRequestException } from '@nestjs/common';
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
      console.error('RAW rulesDto:', JSON.stringify(rulesDto, null, 2));

      const parseResult = pricingRulesSetSchema.safeParse(rulesDto);
      if (!parseResult.success) {
        console.error('pricingRulesSetSchema issues:', JSON.stringify(parseResult.error.issues, null, 2));

        throw new BadRequestException({
          message: 'Invalid pricing rules structure',
          errors: parseResult.error.issues,
        });
      }

      const validatedRules = parseResult.data;

      await this.validateScopeTargets(masterId, versionId, validatedRules, trx);

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
