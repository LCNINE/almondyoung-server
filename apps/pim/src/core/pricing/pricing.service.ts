import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { eq, and, asc, SQL } from 'drizzle-orm';
import { pricingRules, productMasterVersions, productMasterPricingRules, pimSchema } from '../../schema';
import { DbTransaction, PricingRule, VariantPriceSet } from '../../types';
import {
  ReplacePricingRulesDto,
  PricingRulesResponseDto,
  PricingRuleResponseDto,
} from './dto';
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
  ) { }

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
    versionId?: string,
    tx?: DbTransaction,
  ): Promise<PricingRulesResponseDto> {
    return this.inTx(async (trx) => {
      await this.ensureMasterExists(masterId, trx);

      // 매핑 테이블을 통해 pricing rules 조회
      let allRules: any[];

      // version 지정 여부에 따라 조건 추가
      if (versionId !== undefined) {
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
            masterId: productMasterPricingRules.masterId,
            versionId: productMasterPricingRules.versionId,
          })
          .from(pricingRules)
          .innerJoin(
            productMasterPricingRules,
            eq(pricingRules.id, productMasterPricingRules.pricingRuleId),
          )
          .where(
            and(
              eq(productMasterPricingRules.masterId, masterId),
              eq(productMasterPricingRules.versionId, versionId),
            ),
          )
          .orderBy(asc(pricingRules.layer), asc(pricingRules.order));
      } else {
        // active 버전의 rules 가져오기
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
            masterId: productMasterPricingRules.masterId,
            versionId: productMasterPricingRules.versionId,
          })
          .from(pricingRules)
          .innerJoin(
            productMasterPricingRules,
            eq(pricingRules.id, productMasterPricingRules.pricingRuleId),
          )
          .innerJoin(
            productMasterVersions,
            and(
              eq(productMasterPricingRules.masterId, productMasterVersions.masterId),
              eq(productMasterPricingRules.versionId, productMasterVersions.id),
              eq(productMasterVersions.status, 'active'),
            ),
          )
          .where(eq(productMasterVersions.masterId, masterId))
          .orderBy(asc(pricingRules.layer), asc(pricingRules.order));
      }

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
    versionId?: string,
    tx?: DbTransaction,
  ): Promise<PricingRulesResponseDto> {
    return this.inTx(async (trx) => {
      await this.ensureMasterExists(masterId, trx);

      const validatedRules = await this.validatorService.validateRuleSet(
        masterId,
        rulesDto,
        trx,
      );

      // version 결정 (지정되지 않으면 active 버전 사용)
      let actualVersionId: string;
      if (versionId === undefined) {
        const [activeVersion] = await trx
          .select({ id: productMasterVersions.id })
          .from(productMasterVersions)
          .where(
            and(
              eq(productMasterVersions.masterId, masterId),
              eq(productMasterVersions.status, 'active'),
            ),
          )
          .limit(1);

        if (!activeVersion) {
          throw new NotFoundException(`No active version found for master ${masterId}`);
        }
        actualVersionId = activeVersion.id;
      }
      else {
        actualVersionId = versionId;
      }

      // draft 상태 검증
      const [versionToModify] = await trx
        .select({ status: productMasterVersions.status })
        .from(productMasterVersions)
        .where(
          and(
            eq(productMasterVersions.masterId, masterId),
            eq(productMasterVersions.id, actualVersionId),
          ),
        )
        .limit(1);

      if (!versionToModify) {
        throw new NotFoundException(`Version ${actualVersionId} not found for master ${masterId}`);
      }

      if (versionToModify.status !== 'draft') {
        console.error('❌ version is not draft:', versionToModify.status);
        throw new BadRequestException('Cannot modify pricing rules for active or inactive versions');
      }

      // 매핑된 pricingRule ID 조회
      const mappedRuleIds = await trx
        .select({ pricingRuleId: productMasterPricingRules.pricingRuleId })
        .from(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, masterId),
            eq(productMasterPricingRules.versionId, actualVersionId),
          ),
        );

      // 기존 매핑 삭제
      await trx
        .delete(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, masterId),
            eq(productMasterPricingRules.versionId, actualVersionId),
          ),
        );

      // 고아 rules 정리 (다른 버전이 사용하지 않는 경우만 삭제)
      if (mappedRuleIds.length > 0) {
        await this._cleanupOrphanedPricingRules(
          mappedRuleIds.map((r) => r.pricingRuleId),
          trx,
        );
      }

      const rulesToInsert: typeof pricingRules.$inferInsert[] = [];

      for (const rule of validatedRules.basePriceRules) {
        rulesToInsert.push({
          layer: 'base_price',
          order: rule.order,
          scopeType: rule.scopeType,
          scopeTargetIds:
            rule.scopeType === 'all_variants'
              ? null
              : ('scopeTargetIds' in rule ? rule.scopeTargetIds : null),
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
            rule.scopeType === 'all_variants'
              ? null
              : ('scopeTargetIds' in rule ? rule.scopeTargetIds : null),
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
            rule.scopeType === 'all_variants'
              ? null
              : ('scopeTargetIds' in rule ? rule.scopeTargetIds : null),
          operationType: rule.operationType,
          operationValue: rule.operationValue,
          minQuantity: rule.minQuantity,
        });
      }

      if (rulesToInsert.length > 0) {
        const insertedRules = await trx.insert(pricingRules).values(rulesToInsert).returning();

        // 매핑 테이블에 연결
        const mappings = insertedRules.map((rule) => ({
          id: uuidv7(),
          masterId,
          pricingRuleId: rule.id,
          versionId: actualVersionId,
        }));

        await trx.insert(productMasterPricingRules).values(mappings);
      }

      await this.validatorService.validateCalculatedPrices(masterId, trx);

      return this.getMasterRules(masterId, actualVersionId, trx);
    }, tx);
  }

  async deleteMasterRules(
    masterId: string,
    versionId?: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.inTx(async (trx) => {
      await this.ensureMasterExists(masterId, trx);

      // version 결정 (지정되지 않으면 active 버전 사용)
      let actualVersionId: string;
      if (versionId === undefined) {
        const [activeVersion] = await trx
          .select({ id: productMasterVersions.id })
          .from(productMasterVersions)
          .where(
            and(
              eq(productMasterVersions.masterId, masterId),
              eq(productMasterVersions.status, 'active'),
            ),
          )
          .limit(1);

        if (!activeVersion) {
          throw new NotFoundException(`No active version found for master ${masterId}`);
        }
        actualVersionId = activeVersion.id;
      }
      else {
        actualVersionId = versionId;
      }
      // 매핑된 pricingRule ID 조회
      const mappedRuleIds = await trx
        .select({ pricingRuleId: productMasterPricingRules.pricingRuleId })
        .from(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, masterId),
            eq(productMasterPricingRules.versionId, actualVersionId),
          ),
        );

      // 기존 매핑 삭제
      await trx
        .delete(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, masterId),
            eq(productMasterPricingRules.versionId, actualVersionId),
          ),
        );

      // 고아 rules 정리 (다른 버전이 사용하지 않는 경우만 삭제)
      if (mappedRuleIds.length > 0) {
        await this._cleanupOrphanedPricingRules(
          mappedRuleIds.map((r) => r.pricingRuleId),
          trx,
        );
      }
    }, tx);
  }

  async getVariantPriceSet(
    masterId: string,
    variantId: string,
    versionId?: string,
    tx?: DbTransaction,
  ): Promise<VariantPriceSet> {
    return this.inTx(async (trx) => {
      let targetVersionId: string;

      if (versionId) {
        targetVersionId = versionId;
      } else {
        const [activeVersion] = await trx
          .select({ id: productMasterVersions.id })
          .from(productMasterVersions)
          .where(
            and(
              eq(productMasterVersions.masterId, masterId),
              eq(productMasterVersions.status, 'active'),
            ),
          );

        if (!activeVersion) {
          throw new NotFoundException(
            `No active version found for master ${masterId}`,
          );
        }
        targetVersionId = activeVersion.id;
      }

      return this.calculatorService.calculateVariantPriceSet(
        targetVersionId,
        variantId,
        trx,
      );
    }, tx);
  }

  private async ensureMasterExists(
    masterId: string,
    tx: DbTransaction,
  ): Promise<void> {
    const masters = await tx
      .select({ id: productMasterVersions.id })
      .from(productMasterVersions)
      .where(eq(productMasterVersions.masterId, masterId))
      .limit(1);

    if (masters.length === 0) {
      throw new NotFoundException(`Product master ${masterId} not found`);
    }
  }

  private toResponseDto(rule: {
    id: string;
    masterId: string;
    version: number;
    layer: string;
    order: number;
    scopeType: string;
    scopeTargetIds: string[] | null;
    operationType: string;
    operationValue: number;
    minQuantity: number | null;
    createdAt: Date | null;
    updatedAt: Date | null;
  }): PricingRuleResponseDto {
    return PricingMapper.toRuleDto(rule);
  }

  /**
   * 고아 pricing rule 정리
   * - 다른 버전이 참조하지 않는 경우만 삭제
   * - Variants 정리 로직과 동일한 패턴
   */
  private async _cleanupOrphanedPricingRules(
    candidateRuleIds: string[],
    tx: DbTransaction,
  ): Promise<void> {
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
        await tx
          .delete(pricingRules)
          .where(eq(pricingRules.id, ruleId));
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      this.logger.log(
        `Cleaned up ${deletedCount} orphaned pricing rules out of ${candidateRuleIds.length} candidates`,
      );
    }
  }
}

