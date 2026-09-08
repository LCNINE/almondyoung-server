import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { DbTx } from '../../schema/inventory.schema';
import { StockProjectionService } from '../../stock-projection/services/stock-projection.service';
import { WarehouseTransferReader } from '../../warehouse-transfer/services/warehouse-transfer.reader';
import { ReplenishmentStockReader, SkuMasterRow } from './replenishment-stock.reader';
import { assembleSuggestions } from './suggestion.assembler';
import { SkuStockInput, SuggestionRow } from './suggestion.types';
import { SuggestionActionFilter } from '../dto/replenishment-suggestion.dto';

/**
 * 재료 수집(5회 조회) → 순수 조립 → action 필터. 쓰기 없음. procurement · warehouse-transfer 의
 * 실행 API 를 부르지 않는다 — 실행은 화면이 기존 API 로 한다(스펙 §8.2).
 */
@Injectable()
export class ReplenishmentSuggestionReader {
  constructor(
    private readonly stockReader: ReplenishmentStockReader,
    private readonly stockProjection: StockProjectionService,
    private readonly transferReader: WarehouseTransferReader,
  ) {}

  /**
   * actions 가 하나 이상인 행만. action 필터는 actions 를 좁힌 뒤 빈 행을 버린다.
   * evaluated = 조립한 행 수. total = 필터 적용 후(actionable) 전체 행 수 — limit 은 그 뒤에 자른다.
   */
  async list(
    trx: DbTx,
    filter: { action: SuggestionActionFilter; limit?: number },
  ): Promise<{ items: SuggestionRow[]; evaluated: number; total: number }> {
    const rows = await this.assemble(trx);
    const wanted = filter.action === 'all' ? null : filter.action;
    const actionable = rows
      .map((row) => (wanted ? { ...row, actions: row.actions.filter((a) => a.type === wanted) } : row))
      .filter((row) => row.actions.length > 0);
    const items = filter.limit != null ? actionable.slice(0, filter.limit) : actionable;
    return { items, evaluated: rows.length, total: actionable.length };
  }

  /** 어떤 SKU 든 한 행. 없으면 NotFoundError. */
  async findRow(trx: DbTx, skuId: string): Promise<SuggestionRow> {
    const [row] = await this.assemble(trx, [skuId]);
    if (!row) throw new NotFoundError(`SKU not found: ${skuId}`);
    return row;
  }

  private async assemble(trx: DbTx, skuIds?: string[]): Promise<SuggestionRow[]> {
    const sellableWarehouseId = await this.stockReader.findSingleSellableWarehouseId(trx);
    const masters = await this.stockReader.listSkuMasters(trx, skuIds);
    if (masters.length === 0) return [];
    const ids = masters.map((m) => m.skuId);

    const ledgers = await this.stockReader.readLedgerAggregates(trx, ids);
    const reservations = await this.stockReader.readConfirmedReservations(trx, ids);
    const pipeline = await this.stockProjection.getInboundPipeline(
      { skuIds: ids, toWarehouseId: sellableWarehouseId },
      trx,
    );
    const pipelineBySku = new Map(pipeline.items.map((item) => [item.skuId, item]));
    const drafts = await this.transferReader.findDraftPlannedBySku(trx, ids);

    const inputs: SkuStockInput[] = masters.map((master) => {
      const ledger = ledgers.get(master.skuId);
      const reserved = reservations.get(master.skuId);
      const pipe = pipelineBySku.get(master.skuId);
      return {
        ...identity(master),
        onHandTotal: ledger?.onHandTotal ?? 0,
        inTransferTotal: ledger?.inTransferTotal ?? 0,
        reservedTotal: reserved?.reservedTotal ?? 0,
        onHandSellable: ledger?.onHandSellable ?? 0,
        reservedSellable: reserved?.reservedSellable ?? 0,
        nonSellableOnHand: ledger?.nonSellableOnHand ?? [],
        onOrderTotal: pipe?.onOrderTotalQty ?? 0,
        onOrderNonSellable: pipe?.onOrderQty ?? 0,
        inTransitToSellable: pipe?.inTransitQty ?? 0,
        draftTransferPlanned: drafts.get(master.skuId) ?? 0,
      };
    });

    return assembleSuggestions(inputs, { sellableWarehouseId });
  }
}

/** C 단계엔 SKU 예외 테이블이 없다 — excluded 는 항상 false. A+B 가 규칙 층에서 채운다. */
function identity(master: SkuMasterRow) {
  return {
    skuId: master.skuId,
    skuCode: master.skuCode,
    skuName: master.skuName,
    supplier: master.supplier,
    safetyStock: master.safetyStock,
    lot: { moq: master.moq, packingUnit: master.packingUnit },
    excluded: false,
  };
}
