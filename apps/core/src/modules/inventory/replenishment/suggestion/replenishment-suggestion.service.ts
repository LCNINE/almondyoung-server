import { Injectable } from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, DbTx, SkuDemandProfile } from '../../schema/inventory.schema';
import { SuggestionRow } from './suggestion.types';
import { ReplenishmentSuggestionReader } from './replenishment-suggestion.reader';
import { EffectiveParameters, ResolvedSegment } from '../rules/effective-parameters';
import {
  EffectiveParametersDto,
  ReplenishmentSkuDetailDto,
  ReplenishmentSuggestionListDto,
  ReplenishmentSuggestionRowDto,
  ResolvedSegmentDto,
  SkuDemandProfileDto,
  SuggestionActionFilter,
} from '../dto/replenishment-suggestion.dto';

/**
 * 트랜잭션 경계 + DTO 매핑만. 조립 오케스트레이션은 `ReplenishmentSuggestionReader` 가 갖는다.
 */
@Injectable()
export class ReplenishmentSuggestionService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly reader: ReplenishmentSuggestionReader,
  ) {}

  listSuggestions(
    filter: { action: SuggestionActionFilter; limit?: number },
    tx?: DbTx,
  ): Promise<ReplenishmentSuggestionListDto> {
    return this.dbService.run(async (trx) => {
      const { items, evaluated, total } = await this.reader.list(trx, filter);
      return { items: items.map(toDto), evaluated, total };
    }, tx);
  }

  getSku(skuId: string, tx?: DbTx): Promise<ReplenishmentSkuDetailDto> {
    return this.dbService.run(async (trx) => {
      const { row, profile, parameters } = await this.reader.findDetail(trx, skuId);
      return {
        ...toDto(row),
        profile: profile ? toProfileDto(profile) : null,
        parameters: toParametersDto(parameters),
      };
    }, tx);
  }
}

function toDto(row: SuggestionRow): ReplenishmentSuggestionRowDto {
  return {
    skuId: row.skuId,
    skuCode: row.skuCode,
    skuName: row.skuName,
    supplier: row.supplier,
    pattern: row.pattern,
    grade: row.grade,
    confidence: row.confidence,
    demand: row.demand,
    company: row.company,
    sellable: row.sellable,
    actions: row.actions.map((action) =>
      action.type === 'purchase'
        ? {
            type: 'purchase',
            qty: action.qty,
            supplierId: action.supplierId,
            sourceWarehouseId: action.sourceWarehouseId,
          }
        : {
            type: 'transfer',
            qty: action.qty,
            fromWarehouseId: action.fromWarehouseId,
            toWarehouseId: action.toWarehouseId,
            lines: action.lines,
          },
    ),
    flags: [...row.flags],
    legacyReorderPoint: row.legacyReorderPoint,
  };
}

/**
 * 명시 매핑이다 — 구조가 호환된다고 도메인 객체를 그대로 내보내면 `EffectiveParameters` 에
 * 내부 필드가 하나 느는 순간 조용히 API 로 샌다. DTO 매핑은 Service 가 소유한다.
 */
function toParametersDto(p: EffectiveParameters): EffectiveParametersDto {
  return {
    excluded: p.excluded,
    alpha: { value: p.alpha.value, source: p.alpha.source },
    l1: toSegmentDto(p.l1),
    l2: toSegmentDto(p.l2),
    coverDays: { value: p.coverDays.value, source: p.coverDays.source },
    transferCoverDays: { value: p.transferCoverDays.value, source: p.transferCoverDays.source },
    overrideSafetyStock: p.overrideSafetyStock,
    usesDefaultLeadTime: p.usesDefaultLeadTime,
  };
}

function toSegmentDto(s: ResolvedSegment): ResolvedSegmentDto {
  return { meanDays: s.meanDays, stdDays: s.stdDays, source: s.source };
}

function toProfileDto(p: SkuDemandProfile): SkuDemandProfileDto {
  return {
    pattern: p.pattern,
    grade: p.grade,
    adi: p.adi,
    cv2: p.cv2,
    dailyMean: p.dailyMean,
    dailyStd: p.dailyStd,
    dailyMean90: p.dailyMean90,
    sizeMean: p.sizeMean,
    sizeStd: p.sizeStd,
    intervalMean: p.intervalMean,
    historyDays: p.historyDays,
    demandEvents: p.demandEvents,
    classificationFrom: p.classificationFrom,
    classificationTo: p.classificationTo,
    paramFrom: p.paramFrom,
    paramTo: p.paramTo,
    computedAt: p.computedAt.toISOString(),
  };
}
