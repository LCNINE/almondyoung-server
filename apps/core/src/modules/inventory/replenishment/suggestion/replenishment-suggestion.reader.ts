import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { DbTx, ReplenishmentSettings, SkuDemandProfile } from '../../schema/inventory.schema';
import { StockProjectionService } from '../../stock-projection/services/stock-projection.service';
import { InboundPipelineRow } from '../../stock-projection/services/inbound-pipeline.reader';
import { WarehouseTransferReader } from '../../warehouse-transfer/services/warehouse-transfer.reader';
import {
  LedgerAggregate,
  ReplenishmentStockReader,
  ReservationAggregate,
  SkuMasterRow,
} from './replenishment-stock.reader';
import { assembleSuggestions } from './suggestion.assembler';
import { SkuStockInput, SuggestionFlag, SuggestionRow } from './suggestion.types';
import { SuggestionActionFilter } from '../dto/replenishment-suggestion.dto';
import { ReplenishmentSettingsReader } from '../demand/replenishment-settings.reader';
import { DemandProfileReader } from '../demand/demand-profile.reader';
import { kstDateOf } from '../demand/calendar';
import { ReplenishmentRulesReader, routeKey } from '../rules/replenishment-rules.reader';
import { EffectiveParameters, resolveEffectiveParameters } from '../rules/effective-parameters';
import { composeLeadTime, computePolicy } from '../policy/replenishment-policy';

export interface AssembledSku {
  row: SuggestionRow;
  profile: SkuDemandProfile | null;
  parameters: EffectiveParameters;
}

interface Prepared {
  input: SkuStockInput;
  profile: SkuDemandProfile | null;
  parameters: EffectiveParameters;
}

/**
 * 재료 수집(재고 5회 + 프로필 3회 + 규칙 4회) → SKU 별 순수 계산(우선순위 → 정책 두 축) → 순수 조립 → action 필터.
 * 쓰기 없음. procurement · warehouse-transfer 의 실행 API 를 부르지 않는다(스펙 §8.2).
 *
 * 규칙 · 프로필 Reader 는 `tx?: DbTx` 를 마지막 인자로 받는다(CLAUDE.md) — 한 런의 읽기가 같은
 * 스냅샷을 보게 하는 건 여기서 `trx` 를 하나도 빠짐없이 명시로 넘겨 지킨다.
 */
@Injectable()
export class ReplenishmentSuggestionReader {
  constructor(
    private readonly stockReader: ReplenishmentStockReader,
    private readonly stockProjection: StockProjectionService,
    private readonly transferReader: WarehouseTransferReader,
    private readonly settingsReader: ReplenishmentSettingsReader,
    private readonly profileReader: DemandProfileReader,
    private readonly rulesReader: ReplenishmentRulesReader,
  ) {}

  /**
   * actions 가 하나 이상인 행만. action 필터는 actions 를 좁힌 뒤 빈 행을 버린다.
   * evaluated = 조립한 행 수(excluded 제외). total = 필터 적용 후 전체 행 수 — limit 은 그 뒤에 자른다.
   */
  async list(
    trx: DbTx,
    filter: { action: SuggestionActionFilter; limit?: number },
  ): Promise<{ items: SuggestionRow[]; evaluated: number; total: number }> {
    const rows = (await this.assemble(trx, undefined, false)).map((a) => a.row);
    const wanted = filter.action === 'all' ? null : filter.action;
    const actionable = rows
      .map((row) => (wanted ? { ...row, actions: row.actions.filter((a) => a.type === wanted) } : row))
      .filter((row) => row.actions.length > 0);
    const items = filter.limit != null ? actionable.slice(0, filter.limit) : actionable;
    return { items, evaluated: rows.length, total: actionable.length };
  }

  /** 어떤 SKU 든 한 행 — excluded 여도 준다(드로어가 이유를 보여준다). 없으면 NotFoundError. */
  async findDetail(trx: DbTx, skuId: string): Promise<AssembledSku> {
    const [detail] = await this.assemble(trx, [skuId], true);
    if (!detail) throw new NotFoundError(`SKU not found: ${skuId}`);
    return detail;
  }

  private async assemble(trx: DbTx, skuIds: string[] | undefined, includeExcluded: boolean): Promise<AssembledSku[]> {
    const sellableWarehouseId = await this.stockReader.findSingleSellableWarehouseId(trx);
    const masters = await this.stockReader.listSkuMasters(trx, skuIds);
    if (masters.length === 0) return [];
    const ids = masters.map((m) => m.skuId);
    const supplierIds = [...new Set(masters.flatMap((m) => (m.supplier ? [m.supplier.id] : [])))];

    const ledgers = await this.stockReader.readLedgerAggregates(trx, ids);
    const reservations = await this.stockReader.readConfirmedReservations(trx, ids);
    const pipeline = await this.stockProjection.getInboundPipeline(
      { skuIds: ids, toWarehouseId: sellableWarehouseId },
      trx,
    );
    const pipelineBySku = new Map(pipeline.items.map((item) => [item.skuId, item]));
    const drafts = await this.transferReader.findDraftPlannedBySku(trx, ids);

    const settings = await this.settingsReader.read(trx);
    const gradeAlpha = await this.rulesReader.readGradeAlphas(trx);
    const profiles = await this.profileReader.readProfiles(ids, trx);
    const supplierObservations = await this.profileReader.readSupplierLeadTimes(trx);
    const routeObservations = await this.profileReader.readRouteLeadTimes(trx);
    const supplierRules = await this.rulesReader.readSupplierRules(supplierIds, trx);
    const routeRules = await this.rulesReader.readRouteRules(trx);
    const overrides = await this.rulesReader.readSkuOverrides(ids, trx);
    const today = kstDateOf(new Date());

    const prepared = new Map<string, Prepared>();
    for (const master of masters) {
      const profile = profiles.get(master.skuId) ?? null;
      const supplierId = master.supplier?.id ?? null;
      const sourceWarehouseId = master.supplier?.defaultWarehouseId ?? null;
      // 출발 창고가 판매 창고(또는 미정)면 옮길 구간이 없다 — 전사 축 합성에서 L2 와 통합 버퍼를 빼고,
      // 경로 규칙 · 관측도 넘기지 않는다(R1(i): transferCoverDays 는 hasRoute 로 게이팅되지 않으므로
      // 적용될 수 없는 경로 규칙의 커버 일수가 새어들지 않게 호출처가 계약을 지킨다).
      const hasRoute = sourceWarehouseId !== null && sourceWarehouseId !== sellableWarehouseId;
      const key = hasRoute && sourceWarehouseId !== null ? routeKey(sourceWarehouseId, sellableWarehouseId) : null;

      const parameters = resolveEffectiveParameters({
        today,
        settings,
        gradeAlpha,
        grade: profile?.grade ?? 'C',
        override: overrides.get(master.skuId) ?? null,
        supplierRule: supplierId ? (supplierRules.get(supplierId) ?? null) : null,
        supplierObservation: supplierId ? (supplierObservations.get(supplierId) ?? null) : null,
        hasRoute,
        routeRule: key ? (routeRules.get(key) ?? null) : null,
        routeObservation: key ? (routeObservations.get(key) ?? null) : null,
      });

      const input = this.toInput(master, {
        ledger: ledgers.get(master.skuId),
        reserved: reservations.get(master.skuId),
        pipe: pipelineBySku.get(master.skuId),
        drafts: drafts.get(master.skuId) ?? [],
        profile,
        parameters,
        settings,
        hasRoute,
        sourceWarehouseId,
        excluded: includeExcluded ? false : parameters.excluded,
      });
      prepared.set(master.skuId, { input, profile, parameters });
    }

    const rows = assembleSuggestions(
      [...prepared.values()].map((p) => p.input),
      { sellableWarehouseId },
    );
    const result: AssembledSku[] = [];
    for (const row of rows) {
      const p = prepared.get(row.skuId);
      if (p) result.push({ row, profile: p.profile, parameters: p.parameters });
    }
    return result;
  }

  private toInput(
    master: SkuMasterRow,
    ctx: {
      ledger: LedgerAggregate | undefined;
      reserved: ReservationAggregate | undefined;
      pipe: InboundPipelineRow | undefined;
      drafts: Array<{ fromWarehouseId: string; qty: number }>;
      profile: SkuDemandProfile | null;
      parameters: EffectiveParameters;
      settings: ReplenishmentSettings;
      /** 출발 창고 ≠ 판매 창고 — 전사 축 합성에 L2 와 통합 버퍼를 더할지(스펙 §5.2) */
      hasRoute: boolean;
      sourceWarehouseId: string | null;
      excluded: boolean;
    },
  ): SkuStockInput {
    const { profile, parameters, settings } = ctx;
    const pattern = profile?.pattern ?? 'insufficient';
    const base = {
      pattern,
      dailyMean: profile?.dailyMean ?? 0,
      dailyStd: profile?.dailyStd ?? 0,
      dailyMean90: profile?.dailyMean90 ?? 0,
      alpha: parameters.alpha.value,
      overrideSafetyStock: parameters.overrideSafetyStock,
    };
    // §5.2 전사 합성: μ_L = μ_L1 + μ_L2 + 통합 버퍼. 출발 창고가 판매 창고면 μ_L = μ_L1.
    const companyLead = composeLeadTime(
      ctx.hasRoute ? [parameters.l1, parameters.l2] : [parameters.l1],
      ctx.hasRoute ? settings.consolidationBufferDays : 0,
    );
    // §5.2 판매창고 축: μ_L = μ_L2. R1(iii): l2 는 non-nullable 이라 0 폴백이 없다 —
    // 경로 규칙·관측이 없으면 전역 default_transfer_lead_time_* 로 떨어져 있다.
    const sellableLead = parameters.l2;
    const company = computePolicy({ ...base, leadTime: companyLead, coverDays: parameters.coverDays.value });
    const sellable = computePolicy({ ...base, leadTime: sellableLead, coverDays: parameters.transferCoverDays.value });

    const parameterFlags: SuggestionFlag[] = [];
    if (parameters.usesDefaultLeadTime) parameterFlags.push('default_lead_time');
    if (company.confidence === 'low') parameterFlags.push('low_confidence');

    return {
      skuId: master.skuId,
      skuCode: master.skuCode,
      skuName: master.skuName,
      supplier: master.supplier ? { id: master.supplier.id, name: master.supplier.name } : null,
      sourceWarehouseId: ctx.sourceWarehouseId,
      pattern,
      grade: profile?.grade ?? 'C',
      confidence: company.confidence,
      demand: { dailyMean: base.dailyMean, dailyStd: base.dailyStd },
      legacyReorderPoint: company.legacyReorderPoint,
      levels: {
        company: {
          safetyStock: company.safetyStock,
          reorderPoint: company.reorderPoint,
          targetLevel: company.targetLevel,
          leadTimeDays: company.leadTimeDays,
        },
        sellable: {
          safetyStock: sellable.safetyStock,
          reorderPoint: sellable.reorderPoint,
          targetLevel: sellable.targetLevel,
          leadTimeDays: sellable.leadTimeDays,
        },
      },
      parameterFlags,
      lot: { moq: master.moq, packingUnit: master.packingUnit },
      excluded: ctx.excluded,
      onHandTotal: ctx.ledger?.onHandTotal ?? 0,
      inTransferTotal: ctx.ledger?.inTransferTotal ?? 0,
      reservedTotal: ctx.reserved?.reservedTotal ?? 0,
      onHandSellable: ctx.ledger?.onHandSellable ?? 0,
      reservedSellable: ctx.reserved?.reservedSellable ?? 0,
      nonSellableOnHand: ctx.ledger?.nonSellableOnHand ?? [],
      onOrderTotal: ctx.pipe?.onOrderTotalQty ?? 0,
      onOrderNonSellable: ctx.pipe?.onOrderQty ?? 0,
      inTransitToSellable: ctx.pipe?.inTransitQty ?? 0,
      draftTransferPlanned: ctx.drafts,
    };
  }
}
