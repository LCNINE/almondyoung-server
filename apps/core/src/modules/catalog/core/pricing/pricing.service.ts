import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { eq, and, asc, SQL } from 'drizzle-orm';
import { pricingRules, productMasterVersions, productMasterPricingRules, pimSchema } from '../../schema/catalog.schema';
import { DbTransaction, PricingRule, VariantPriceSet } from '../../catalog.types';
import { ReplacePricingRulesDto, PricingRulesResponseDto, PricingRuleResponseDto } from './dto';
import { PricingMapper } from './mappers';
import { PricingValidatorService } from './pricing-validator.service';
import { PricingCalculatorService } from './pricing-calculator.service';
import { v7 as uuidv7 } from 'uuid';

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    @InjectTypedDb<typeof pimSchema>()
    private readonly dbService: DbService<typeof pimSchema>,
    private readonly validatorService: PricingValidatorService,
    private readonly calculatorService: PricingCalculatorService,
  ) {}

  async getVersionRules(versionId: string, tx?: DbTransaction): Promise<PricingRulesResponseDto> {
    return this.dbService.run(async (trx) => {
      // version 존재 여부 확인
      const [version] = await trx
        .select({ id: productMasterVersions.id })
        .from(productMasterVersions)
        .where(eq(productMasterVersions.id, versionId))
        .limit(1);

      if (!version) {
        throw new NotFoundException(`Version ${versionId} not found`);
      }

      // versionId만으로 pricing rules 조회
      const allRules = await trx
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
        .where(eq(productMasterPricingRules.versionId, versionId))
        .orderBy(asc(pricingRules.layer), asc(pricingRules.order));

      return {
        basePriceRules: allRules.filter((r) => r.layer === 'base_price').map((r) => PricingMapper.toRuleDto(r)),
        membershipPriceRules: allRules
          .filter((r) => r.layer === 'membership_price')
          .map((r) => PricingMapper.toRuleDto(r)),
        tieredPriceRules: allRules.filter((r) => r.layer === 'tiered_price').map((r) => PricingMapper.toRuleDto(r)),
      };
    }, tx);
  }

  async replaceVersionRules(
    versionId: string,
    rulesDto: ReplacePricingRulesDto,
    tx?: DbTransaction,
  ): Promise<PricingRulesResponseDto> {
    return this.dbService.run(async (trx) => {
      // draft 상태 검증 및 masterId 가져오기
      const [version] = await trx
        .select({
          status: productMasterVersions.status,
          masterId: productMasterVersions.masterId,
        })
        .from(productMasterVersions)
        .where(eq(productMasterVersions.id, versionId))
        .limit(1);

      if (!version) {
        throw new NotFoundException(`Version ${versionId} not found`);
      }

      if (version.status !== 'draft') {
        throw new BadRequestException('Only draft versions can be modified');
      }

      // validation (masterId는 version에서 가져온 것 사용)
      const validatedRules = await this.validatorService.validateRuleSet(version.masterId, versionId, rulesDto, trx);

      // 매핑된 pricingRule ID 조회 (versionId만 사용)
      const mappedRuleIds = await trx
        .select({ pricingRuleId: productMasterPricingRules.pricingRuleId })
        .from(productMasterPricingRules)
        .where(eq(productMasterPricingRules.versionId, versionId));

      // 기존 매핑 삭제 (versionId만 사용)
      await trx.delete(productMasterPricingRules).where(eq(productMasterPricingRules.versionId, versionId));

      // 고아 rules 정리
      if (mappedRuleIds.length > 0) {
        await this._cleanupOrphanedPricingRules(
          mappedRuleIds.map((r) => r.pricingRuleId),
          trx,
        );
      }

      const rulesToInsert: (typeof pricingRules.$inferInsert)[] = [];

      for (const rule of validatedRules.basePriceRules) {
        rulesToInsert.push({
          layer: 'base_price',
          order: rule.order,
          scopeType: rule.scopeType,
          scopeTargetIds:
            rule.scopeType === 'all_variants' ? null : 'scopeTargetIds' in rule ? rule.scopeTargetIds : null,
          operationType: rule.operationType,
          operationValue: rule.operationValue,
          minQuantity: null,
        });
      }

      for (const rule of validatedRules.membershipPriceRules) {
        rulesToInsert.push({
          layer: 'membership_price',
          order: rule.order,
          scopeType: rule.scopeType,
          scopeTargetIds:
            rule.scopeType === 'all_variants' ? null : 'scopeTargetIds' in rule ? rule.scopeTargetIds : null,
          operationType: rule.operationType,
          operationValue: rule.operationValue,
          minQuantity: null,
        });
      }

      for (const rule of validatedRules.tieredPriceRules) {
        rulesToInsert.push({
          layer: 'tiered_price',
          order: rule.order,
          scopeType: rule.scopeType,
          scopeTargetIds:
            rule.scopeType === 'all_variants' ? null : 'scopeTargetIds' in rule ? rule.scopeTargetIds : null,
          operationType: rule.operationType,
          operationValue: rule.operationValue,
          minQuantity: rule.minQuantity,
        });
      }

      if (rulesToInsert.length > 0) {
        const insertedRules = await trx.insert(pricingRules).values(rulesToInsert).returning();

        // 매핑 테이블에 연결 (masterId는 version에서 가져온 것 사용)
        const mappings = insertedRules.map((rule) => ({
          id: uuidv7(),
          masterId: version.masterId,
          pricingRuleId: rule.id,
          versionId: versionId,
        }));

        await trx.insert(productMasterPricingRules).values(mappings);
      }

      return this.getVersionRules(versionId, trx);
    }, tx);
  }

  async deleteVersionRules(versionId: string, tx?: DbTransaction): Promise<void> {
    return this.dbService.run(async (trx) => {
      // draft 상태 검증
      const [version] = await trx
        .select({ status: productMasterVersions.status })
        .from(productMasterVersions)
        .where(eq(productMasterVersions.id, versionId))
        .limit(1);

      if (!version) {
        throw new NotFoundException(`Version ${versionId} not found`);
      }

      if (version.status !== 'draft') {
        throw new BadRequestException('Only draft versions can be modified');
      }

      // 매핑된 pricingRule ID 조회 (versionId만 사용)
      const mappedRuleIds = await trx
        .select({ pricingRuleId: productMasterPricingRules.pricingRuleId })
        .from(productMasterPricingRules)
        .where(eq(productMasterPricingRules.versionId, versionId));

      // 기존 매핑 삭제 (versionId만 사용)
      await trx.delete(productMasterPricingRules).where(eq(productMasterPricingRules.versionId, versionId));

      // 고아 rules 정리
      if (mappedRuleIds.length > 0) {
        await this._cleanupOrphanedPricingRules(
          mappedRuleIds.map((r) => r.pricingRuleId),
          trx,
        );
      }
    }, tx);
  }

  async getVariantPriceSet(versionId: string, variantId: string, tx?: DbTransaction): Promise<VariantPriceSet> {
    return this.dbService.run(async (trx) => {
      return this.calculatorService.calculateVariantPriceSet(versionId, variantId, trx);
    }, tx);
  }

  async getVariantPriceSetMany(
    versionId: string,
    variantIds: string[],
    tx?: DbTransaction,
  ): Promise<VariantPriceSet[]> {
    return this.dbService.run(async (trx) => {
      return this.calculatorService.calculateVariantPriceSetMany(versionId, variantIds, trx);
    }, tx);
  }

  /**
   * 고아 pricing rule 정리
   * - 다른 버전이 참조하지 않는 경우만 삭제
   * - Variants 정리 로직과 동일한 패턴
   */
  private async _cleanupOrphanedPricingRules(candidateRuleIds: string[], tx: DbTransaction): Promise<void> {
    if (candidateRuleIds.length === 0) {
      return;
    }

    let deletedCount = 0;

    for (const ruleId of candidateRuleIds) {
      // 1. 이 rule을 참조하는 모든 버전 매핑 조회
      const allMappings = await tx
        .select()
        .from(productMasterPricingRules)
        .where(eq(productMasterPricingRules.pricingRuleId, ruleId));

      // 2. 아무도 참조하지 않으면 삭제
      if (allMappings.length === 0) {
        await tx.delete(pricingRules).where(eq(pricingRules.id, ruleId));
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      this.logger.log(`Cleaned up ${deletedCount} orphaned pricing rules out of ${candidateRuleIds.length} candidates`);
    }
  }
}
