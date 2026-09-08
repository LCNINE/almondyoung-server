import { Injectable } from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { NotFoundError } from '@app/shared';
import { wmsSchema, DbTx, ReplenishmentSettings } from '../../schema/inventory.schema';
import { ReplenishmentSettingsReader } from '../demand/replenishment-settings.reader';
import {
  ReplenishmentRulesReader,
  SupplierRuleRow,
  RouteRuleRow,
  SkuOverrideRow,
  LeadTimeRuleRow,
} from './replenishment-rules.reader';
import { ReplenishmentRulesManager } from './replenishment-rules.manager';
import {
  GradeRuleDto,
  GradeRulesDto,
  LeadTimeRuleDto,
  ReplenishmentSettingsDto,
  RouteRuleRowDto,
  RouteRulesListDto,
  SkuOverrideRowDto,
  SkuOverridesListDto,
  SupplierRuleRowDto,
  SupplierRulesListDto,
  UpdateReplenishmentSettingsDto,
  UpsertLeadTimeRuleDto,
  UpsertSkuOverrideDto,
} from '../dto/replenishment-rules.dto';

/** 트랜잭션 경계 + DTO 매핑. 검증 · 쓰기는 Manager, 조회는 Reader. */
@Injectable()
export class ReplenishmentRulesService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly settingsReader: ReplenishmentSettingsReader,
    private readonly reader: ReplenishmentRulesReader,
    private readonly manager: ReplenishmentRulesManager,
  ) {}

  async getSettings(tx?: DbTx): Promise<ReplenishmentSettingsDto> {
    return toSettingsDto(await this.settingsReader.read(tx));
  }
  async updateSettings(dto: UpdateReplenishmentSettingsDto, tx?: DbTx): Promise<ReplenishmentSettingsDto> {
    return toSettingsDto(await this.manager.updateSettings(dto, tx));
  }

  async getGrades(tx?: DbTx): Promise<GradeRulesDto> {
    return { items: (await this.reader.listGradeRules(tx)).map((r) => ({ grade: r.grade, alpha: r.alpha })) };
  }
  async updateGrades(items: GradeRuleDto[], tx?: DbTx): Promise<GradeRulesDto> {
    return { items: (await this.manager.replaceGradeRules(items, tx)).map((r) => ({ grade: r.grade, alpha: r.alpha })) };
  }

  async listSuppliers(tx?: DbTx): Promise<SupplierRulesListDto> {
    return { items: (await this.reader.listSupplierRows(tx)).map(toSupplierRowDto) };
  }
  async upsertSupplier(supplierId: string, dto: UpsertLeadTimeRuleDto, tx?: DbTx): Promise<LeadTimeRuleDto> {
    return toRuleDto(await this.manager.upsertSupplierRule(supplierId, dto, tx));
  }
  deleteSupplier(supplierId: string, tx?: DbTx): Promise<void> {
    return this.manager.deleteSupplierRule(supplierId, tx);
  }

  async listRoutes(tx?: DbTx): Promise<RouteRulesListDto> {
    return { items: (await this.reader.listRouteRows(tx)).map(toRouteRowDto) };
  }
  async upsertRoute(from: string, to: string, dto: UpsertLeadTimeRuleDto, tx?: DbTx): Promise<LeadTimeRuleDto> {
    return toRuleDto(await this.manager.upsertRouteRule(from, to, dto, tx));
  }
  deleteRoute(from: string, to: string, tx?: DbTx): Promise<void> {
    return this.manager.deleteRouteRule(from, to, tx);
  }

  async listSkuOverrides(q: string | undefined, limit: number, tx?: DbTx): Promise<SkuOverridesListDto> {
    return { items: (await this.reader.searchSkuOverrides(q, limit, tx)).map(toOverrideRowDto) };
  }
  upsertSkuOverride(skuId: string, dto: UpsertSkuOverrideDto, tx?: DbTx): Promise<SkuOverrideRowDto> {
    // 쓰기와 "코드 · 이름 붙인 되읽기" 가 한 트랜잭션이어야 화면이 방금 저장한 행을 그대로 받는다.
    return this.dbService.run(async (trx) => {
      await this.manager.upsertSkuOverride(skuId, dto, trx);
      const [row] = await this.reader.searchSkuOverridesById(skuId, trx);
      // 같은 트랜잭션이라 방금 쓴 행이 없을 수는 없지만, 없으면 undefined 를 매핑해 TypeError 가 된다.
      if (!row) throw new NotFoundError(`SKU 예외 없음: ${skuId}`);
      return toOverrideRowDto(row);
    }, tx);
  }
  deleteSkuOverride(skuId: string, tx?: DbTx): Promise<void> {
    return this.manager.deleteSkuOverride(skuId, tx);
  }
}

function toSettingsDto(s: ReplenishmentSettings): ReplenishmentSettingsDto {
  return {
    key: s.key,
    adiThreshold: s.adiThreshold,
    cv2Threshold: s.cv2Threshold,
    classificationWindowDays: s.classificationWindowDays,
    paramWindowDaysFrequent: s.paramWindowDaysFrequent,
    paramWindowDaysSparse: s.paramWindowDaysSparse,
    minDemandEvents: s.minDemandEvents,
    minLeadTimeObservations: s.minLeadTimeObservations,
    leadTimeWindowDays: s.leadTimeWindowDays,
    gradeACut: s.gradeACut,
    gradeBCut: s.gradeBCut,
    demandCoreSince: s.demandCoreSince,
    demandRecomputeDays: s.demandRecomputeDays,
    consolidationBufferDays: s.consolidationBufferDays,
    defaultLeadTimeDays: s.defaultLeadTimeDays,
    defaultLeadTimeStdDays: s.defaultLeadTimeStdDays,
    defaultTransferLeadTimeDays: s.defaultTransferLeadTimeDays,
    defaultTransferLeadTimeStdDays: s.defaultTransferLeadTimeStdDays,
    defaultLeadTimeCv: s.defaultLeadTimeCv,
    defaultCoverDays: s.defaultCoverDays,
    defaultTransferCoverDays: s.defaultTransferCoverDays,
    updatedAt: s.updatedAt.toISOString(),
  };
}
function toRuleDto(r: LeadTimeRuleRow): LeadTimeRuleDto {
  return {
    leadTimeDays: r.leadTimeDays,
    leadTimeStdDays: r.leadTimeStdDays,
    coverDays: r.coverDays,
    updatedAt: r.updatedAt.toISOString(),
  };
}
function toSupplierRowDto(r: SupplierRuleRow): SupplierRuleRowDto {
  return {
    supplierId: r.supplierId,
    supplierName: r.supplierName,
    defaultWarehouseId: r.defaultWarehouseId,
    rule: r.rule ? toRuleDto(r.rule) : null,
    observation: r.observation,
  };
}
function toRouteRowDto(r: RouteRuleRow): RouteRuleRowDto {
  return {
    fromWarehouseId: r.fromWarehouseId,
    fromWarehouseName: r.fromWarehouseName,
    toWarehouseId: r.toWarehouseId,
    toWarehouseName: r.toWarehouseName,
    rule: r.rule ? toRuleDto(r.rule) : null,
    observation: r.observation,
  };
}
function toOverrideRowDto(r: SkuOverrideRow): SkuOverrideRowDto {
  return {
    skuId: r.skuId,
    skuCode: r.skuCode,
    skuName: r.skuName,
    mode: r.mode,
    excludedUntil: r.excludedUntil,
    safetyStock: r.safetyStock,
    alpha: r.alpha,
    memo: r.memo,
    updatedAt: r.updatedAt.toISOString(),
  };
}
