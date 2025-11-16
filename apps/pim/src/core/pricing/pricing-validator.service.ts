import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { eq, inArray } from 'drizzle-orm';
import { 
  productOptionValues,
  productVariants,
  pimSchema 
} from '../../schema';
import { DbTransaction } from '../../types';
import { ValidatedPricingRulesSet, pricingRulesSetSchema } from './dto';
import { PricingCalculatorService } from './pricing-calculator.service';

@Injectable()
export class PricingValidatorService {
  constructor(
    @InjectTypedDb<typeof pimSchema>()
    private readonly dbService: DbService<typeof pimSchema>,
    private readonly calculatorService: PricingCalculatorService,
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

  async validateRuleSet(
    masterId: string,
    rulesDto: any,
    tx?: DbTransaction,
  ): Promise<ValidatedPricingRulesSet> {
    return this.inTx(async (trx) => {
      const parseResult = pricingRulesSetSchema.safeParse(rulesDto);
      if (!parseResult.success) {
        throw new BadRequestException({
          message: 'Invalid pricing rules structure',
          errors: parseResult.error.errors,
        });
      }

      const validatedRules = parseResult.data;

      await this.validateScopeTargets(masterId, validatedRules, trx);

      return validatedRules;
    }, tx);
  }

  private async validateScopeTargets(
    masterId: string,
    rulesSet: ValidatedPricingRulesSet,
    tx: DbTransaction,
  ): Promise<void> {
    const allRules = [
      ...rulesSet.basePriceRules,
      ...rulesSet.membershipPriceRules,
      ...rulesSet.tieredPriceRules,
    ];

    const withOptionRules = allRules.filter((r) => r.scopeType === 'with_option');
    const variantsRules = allRules.filter((r) => r.scopeType === 'variants');

    if (withOptionRules.length > 0) {
      const allOptionValueIds = withOptionRules
        .flatMap((r) => r.scopeTargetIds || [])
        .filter((id, index, self) => self.indexOf(id) === index);

      if (allOptionValueIds.length > 0) {
        const optionValues = await tx
          .select({ 
            id: productOptionValues.id,
            masterId: productOptionValues.masterId 
          })
          .from(productOptionValues)
          .where(inArray(productOptionValues.id, allOptionValueIds));

        const foundIds = new Set(optionValues.map((ov) => ov.id));
        const missingIds = allOptionValueIds.filter((id) => !foundIds.has(id));
        
        if (missingIds.length > 0) {
          throw new BadRequestException(
            `Option value IDs not found: ${missingIds.join(', ')}`,
          );
        }

        const invalidMasterIds = optionValues.filter(
          (ov) => ov.masterId !== masterId,
        );
        if (invalidMasterIds.length > 0) {
          throw new BadRequestException(
            `Option values do not belong to master ${masterId}: ${invalidMasterIds.map((ov) => ov.id).join(', ')}`,
          );
        }
      }
    }

    if (variantsRules.length > 0) {
      const allVariantIds = variantsRules
        .flatMap((r) => r.scopeTargetIds || [])
        .filter((id, index, self) => self.indexOf(id) === index);

      if (allVariantIds.length > 0) {
        const variants = await tx
          .select({ 
            id: productVariants.id,
            masterId: productVariants.masterId 
          })
          .from(productVariants)
          .where(inArray(productVariants.id, allVariantIds));

        const foundIds = new Set(variants.map((v) => v.id));
        const missingIds = allVariantIds.filter((id) => !foundIds.has(id));
        
        if (missingIds.length > 0) {
          throw new BadRequestException(
            `Variant IDs not found: ${missingIds.join(', ')}`,
          );
        }

        const invalidMasterIds = variants.filter(
          (v) => v.masterId !== masterId,
        );
        if (invalidMasterIds.length > 0) {
          throw new BadRequestException(
            `Variants do not belong to master ${masterId}: ${invalidMasterIds.map((v) => v.id).join(', ')}`,
          );
        }
      }
    }
  }

  async validateCalculatedPrices(
    masterId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.inTx(async (trx) => {
      const variants = await trx
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(eq(productVariants.masterId, masterId));

      if (variants.length === 0) {
        return;
      }

      const errors: string[] = [];

      for (const variant of variants) {
        try {
          const baseResult = await this.calculatorService.calculateVariantPrice(
            masterId,
            variant.id,
            undefined,
            'regular',
            trx,
          );

          if (baseResult.price <= 0) {
            errors.push(
              `Variant ${variant.id}: base price is ${baseResult.price} (must be > 0)`,
            );
          }

          const membershipResult =
            await this.calculatorService.calculateVariantPrice(
              masterId,
              variant.id,
              undefined,
              'membership',
              trx,
            );

          if (membershipResult.price < 0) {
            errors.push(
              `Variant ${variant.id}: membership price is ${membershipResult.price} (must be >= 0)`,
            );
          }
        } catch (error) {
          errors.push(
            `Variant ${variant.id}: price calculation failed - ${error.message}`,
          );
        }
      }

      if (errors.length > 0) {
        throw new BadRequestException({
          message: 'Invalid calculated prices',
          errors,
        });
      }
    }, tx);
  }
}

