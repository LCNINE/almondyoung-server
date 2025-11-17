import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { eq, and, asc, SQL } from 'drizzle-orm';
import { pricingRules, productMasters, productMasterPricingRules, pimSchema } from '../../schema';
import { DbTransaction, PricingRule } from '../../types';
import {
  ReplacePricingRulesDto,
  PricingRulesResponseDto,
  PricingRuleResponseDto,
} from './dto';
import { PricingValidatorService } from './pricing-validator.service';
import { v7 as uuidv7 } from 'uuid';

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

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
    version?: number,
    tx?: DbTransaction,
  ): Promise<PricingRulesResponseDto> {
    return this.inTx(async (trx) => {
      await this.ensureMasterExists(masterId, trx);

      // 매핑 테이블을 통해 pricing rules 조회
      let allRules: any[];

      // version 지정 여부에 따라 조건 추가
      if (version !== undefined) {
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
            version: productMasterPricingRules.version,
          })
          .from(pricingRules)
          .innerJoin(
            productMasterPricingRules,
            eq(pricingRules.id, productMasterPricingRules.pricingRuleId),
          )
          .where(
            and(
              eq(productMasterPricingRules.masterId, masterId),
              eq(productMasterPricingRules.version, version),
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
            version: productMasterPricingRules.version,
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
              eq(productMasters.versionStatus, 'active'),
            ),
          )
          .where(eq(productMasters.masterId, masterId))
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
    version?: number,
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
      let actualVersion = version;
      if (actualVersion === undefined) {
        const [activeMaster] = await trx
          .select({ version: productMasters.version })
          .from(productMasters)
          .where(
            and(
              eq(productMasters.masterId, masterId),
              eq(productMasters.versionStatus, 'active'),
            ),
          )
          .limit(1);

        if (!activeMaster) {
          throw new NotFoundException(`No active version found for master ${masterId}`);
        }
        actualVersion = activeMaster.version;
      }

      // 매핑된 pricingRule ID 조회
      const mappedRuleIds = await trx
        .select({ pricingRuleId: productMasterPricingRules.pricingRuleId })
        .from(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, masterId),
            eq(productMasterPricingRules.version, actualVersion),
          ),
        );

      // 기존 매핑 삭제
      await trx
        .delete(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, masterId),
            eq(productMasterPricingRules.version, actualVersion),
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
          version: actualVersion,
          createdAt: new Date(),
        }));

        await trx.insert(productMasterPricingRules).values(mappings);
      }

      await this.validatorService.validateCalculatedPrices(masterId, trx);

      return this.getMasterRules(masterId, actualVersion, trx);
    }, tx);
  }

  async deleteMasterRules(
    masterId: string,
    version?: number,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.inTx(async (trx) => {
      await this.ensureMasterExists(masterId, trx);

      // version 결정 (지정되지 않으면 active 버전 사용)
      let actualVersion = version;
      if (actualVersion === undefined) {
        const [activeMaster] = await trx
          .select({ version: productMasters.version })
          .from(productMasters)
          .where(
            and(
              eq(productMasters.masterId, masterId),
              eq(productMasters.versionStatus, 'active'),
            ),
          )
          .limit(1);

        if (!activeMaster) {
          throw new NotFoundException(`No active version found for master ${masterId}`);
        }
        actualVersion = activeMaster.version;
      }

      // 매핑된 pricingRule ID 조회
      const mappedRuleIds = await trx
        .select({ pricingRuleId: productMasterPricingRules.pricingRuleId })
        .from(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, masterId),
            eq(productMasterPricingRules.version, actualVersion),
          ),
        );

      // 기존 매핑 삭제
      await trx
        .delete(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, masterId),
            eq(productMasterPricingRules.version, actualVersion),
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

