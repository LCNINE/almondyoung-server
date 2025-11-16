import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { eq, and, asc } from 'drizzle-orm';
import { pricingRules, productMasters, pimSchema } from '../../schema';
import { DbTransaction, PricingRule } from '../../types';
import {
  ReplacePricingRulesDto,
  PricingRulesResponseDto,
  PricingRuleResponseDto,
} from './dto';
import { PricingValidatorService } from './pricing-validator.service';

@Injectable()
export class PricingService {
  constructor(
    @InjectTypedDb<typeof pimSchema>()
    private readonly dbService: DbService<typeof pimSchema>,
    private readonly validatorService: PricingValidatorService,
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

  async getMasterRules(
    masterId: string,
    tx?: DbTransaction,
  ): Promise<PricingRulesResponseDto> {
    return this.inTx(async (trx) => {
      await this.ensureMasterExists(masterId, trx);

      const allRules = await trx
        .select()
        .from(pricingRules)
        .where(eq(pricingRules.masterId, masterId))
        .orderBy(asc(pricingRules.layer), asc(pricingRules.order));

      return {
        basePriceRules: allRules
          .filter((r) => r.layer === 'base_price')
          .map(this.toResponseDto),
        membershipPriceRules: allRules
          .filter((r) => r.layer === 'membership_price')
          .map(this.toResponseDto),
        tieredPriceRules: allRules
          .filter((r) => r.layer === 'tiered_price')
          .map(this.toResponseDto),
      };
    }, tx);
  }

  async replaceMasterRules(
    masterId: string,
    rulesDto: ReplacePricingRulesDto,
    tx?: DbTransaction,
  ): Promise<PricingRulesResponseDto> {
    return this.inTx(async (trx) => {
      await this.ensureMasterExists(masterId, trx);

      const validatedRules = await this.validatorService.validateRuleSet(
        masterId,
        rulesDto,
        trx,
      );

      await trx.delete(pricingRules).where(eq(pricingRules.masterId, masterId));

      const rulesToInsert: typeof pricingRules.$inferInsert[] = [];

      for (const rule of validatedRules.basePriceRules) {
        rulesToInsert.push({
          masterId,
          layer: 'base_price',
          order: rule.order,
          scopeType: rule.scopeType,
          scopeTargetIds: rule.scopeTargetIds || null,
          operationType: rule.operationType,
          operationValue: rule.operationValue,
          minQuantity: null,
        });
      }

      for (const rule of validatedRules.membershipPriceRules) {
        rulesToInsert.push({
          masterId,
          layer: 'membership_price',
          order: rule.order,
          scopeType: rule.scopeType,
          scopeTargetIds: rule.scopeTargetIds || null,
          operationType: rule.operationType,
          operationValue: rule.operationValue,
          minQuantity: null,
        });
      }

      for (const rule of validatedRules.tieredPriceRules) {
        rulesToInsert.push({
          masterId,
          layer: 'tiered_price',
          order: rule.order,
          scopeType: rule.scopeType,
          scopeTargetIds: rule.scopeTargetIds || null,
          operationType: rule.operationType,
          operationValue: rule.operationValue,
          minQuantity: rule.minQuantity,
        });
      }

      if (rulesToInsert.length > 0) {
        await trx.insert(pricingRules).values(rulesToInsert);
      }

      await this.validatorService.validateCalculatedPrices(masterId, trx);

      return this.getMasterRules(masterId, trx);
    }, tx);
  }

  async deleteMasterRules(
    masterId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.inTx(async (trx) => {
      await this.ensureMasterExists(masterId, trx);

      await trx.delete(pricingRules).where(eq(pricingRules.masterId, masterId));
    }, tx);
  }

  private async ensureMasterExists(
    masterId: string,
    tx: DbTransaction,
  ): Promise<void> {
    const masters = await tx
      .select({ id: productMasters.id })
      .from(productMasters)
      .where(eq(productMasters.id, masterId))
      .limit(1);

    if (masters.length === 0) {
      throw new NotFoundException(`Product master ${masterId} not found`);
    }
  }

  private toResponseDto(rule: PricingRule): PricingRuleResponseDto {
    return {
      id: rule.id,
      masterId: rule.masterId,
      layer: rule.layer as 'base_price' | 'membership_price' | 'tiered_price',
      order: rule.order,
      scopeType: rule.scopeType as 'all_variants' | 'with_option' | 'variants',
      scopeTargetIds: rule.scopeTargetIds,
      operationType: rule.operationType as 'offset' | 'scale' | 'override',
      operationValue: rule.operationValue,
      minQuantity: rule.minQuantity,
      createdAt: rule.createdAt!,
      updatedAt: rule.updatedAt!,
    };
  }
}

