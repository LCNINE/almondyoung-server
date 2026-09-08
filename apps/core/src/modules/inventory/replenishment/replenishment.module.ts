import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { CoreInventoryModule } from '../core/inventory.module';
import { StockProjectionModule } from '../stock-projection/stock-projection.module';
import { WarehouseTransferModule } from '../warehouse-transfer/warehouse-transfer.module';
import { ReplenishmentSuggestionController } from './controllers/replenishment-suggestion.controller';
import { ReplenishmentProfileController } from './controllers/replenishment-profile.controller';
import { ReplenishmentRulesController } from './controllers/replenishment-rules.controller';
import { ReplenishmentSuggestionService } from './suggestion/replenishment-suggestion.service';
import { ReplenishmentSuggestionReader } from './suggestion/replenishment-suggestion.reader';
import { ReplenishmentStockReader } from './suggestion/replenishment-stock.reader';
import { ReplenishmentSettingsReader } from './demand/replenishment-settings.reader';
import { DemandProfileReader } from './demand/demand-profile.reader';
import { DemandSeriesWriter } from './demand/demand-series.writer';
import { DemandProfileRefresher } from './demand/demand-profile.refresher';
import { LeadTimeProfileRefresher } from './demand/lead-time-profile.refresher';
import { ReplenishmentRefreshJob } from './demand/replenishment-refresh.job';
import { ReplenishmentProfileService } from './demand/replenishment-profile.service';
import { ReplenishmentRulesReader } from './rules/replenishment-rules.reader';
import { ReplenishmentRulesManager } from './rules/replenishment-rules.manager';
import { ReplenishmentRulesService } from './rules/replenishment-rules.service';

/**
 * 재고 보충 제안 (#743, 스펙 2026-09-08). procurement · warehouse-transfer 의 형제.
 *
 * - `ProcurementModule` 을 import 하지 않는다. 제안은 읽기 전용이고 실행(카트·이동 지시서)은
 *   화면이 기존 API 를 부른다. `replenishment-boundary.arch.spec.ts` 가 이 0 을 고정한다.
 * - `WarehouseTransferModule` 은 draft 지시서 planned 합을 Reader 에서 빌리기 위해서다 —
 *   `StockProjectionModule` 이 파이프라인 ③ 때문에 같은 모듈을 빌리는 것과 같은 형태.
 * - A 단계: demand/ 가 야간 크론(`replenishment-profile-refresh`)으로 시계열 · 프로필 · 리드타임을 물질화한다.
 *   `SCHEDULE_ROOT` 는 전역이라 여기서 ScheduleModule 을 import 하지 않는다.
 * - B 단계: 제안은 프로필(demand/) · 규칙(rules/) · (s, S) 정책(policy/)으로 두 축의 수준을 계산한다.
 *   C 의 자리표시(SKU 마스터의 정적 안전재고 컬럼)는 더 이상 읽지 않는다 — 안전재고를 손으로
 *   정하고 싶으면 `replenishment_sku_overrides.safety_stock` 이 그 자리다.
 */
@Module({
  imports: [SharedModule, CoreInventoryModule, StockProjectionModule, WarehouseTransferModule],
  controllers: [ReplenishmentSuggestionController, ReplenishmentProfileController, ReplenishmentRulesController],
  providers: [
    ReplenishmentSuggestionService,
    ReplenishmentSuggestionReader,
    ReplenishmentStockReader,
    ReplenishmentSettingsReader,
    DemandProfileReader,
    DemandSeriesWriter,
    DemandProfileRefresher,
    LeadTimeProfileRefresher,
    ReplenishmentRefreshJob,
    ReplenishmentProfileService,
    ReplenishmentRulesReader,
    ReplenishmentRulesManager,
    ReplenishmentRulesService,
  ],
  exports: [ReplenishmentSuggestionService, ReplenishmentSettingsReader, ReplenishmentRulesReader],
})
export class ReplenishmentModule {}
