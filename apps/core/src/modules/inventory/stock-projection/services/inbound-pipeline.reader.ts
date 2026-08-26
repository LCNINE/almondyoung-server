import { Injectable } from '@nestjs/common';
import { and, eq, inArray, not, sql } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { inSellableWarehouse } from '../../shared/availability/sellable-warehouses';
import { WarehouseTransferReader } from '../../warehouse-transfer/services/warehouse-transfer.reader';

export interface InboundPipelineRow {
  skuId: string;
  onOrderQty: number;
  onOrderEta: Date | null;
  awaitingTransferQty: number;
  inTransitQty: number;
  inTransitEta: Date | null;
}

interface QtyWithEta {
  qty: number;
  eta: Date | null;
}

/**
 * 대상 창고(판매 창고) 관점의 공급 파이프라인.
 *
 * ① 발주 잔량   — 비판매 창고로 입고 예정인 pending 계획
 * ② 이동 대기   — 비판매 창고 ON_HAND (아직 선적되지 않음)
 * ③ 이동 중     — 선적됐으나 도착·분실 정산이 남은 지시서 잔량
 *
 * ②를 빼면 "재고 0, 입고예정 0" 으로 보여 중복 발주가 난다 — ②는 부천 판매가능수량에도
 * 없고(중국은 비판매 창고), 입고예정에도 없고, 발주는 이미 완료 상태라 어디에도 안 보인다.
 * 예정일이 없는 단계는 숨기지 않고 null 로 낸다 — 숨기면 그 구간이 다시 사각지대가 된다.
 *
 * ②와 ③은 겹치지 않는다: 선적된 물량은 이미 IN_TRANSFER 로 옮겨져 ON_HAND 에서 빠졌다.
 *
 * 알려진 범위 한계: `toWarehouseId` 로 좁혀지는 것은 ③뿐이다. ①②는 비판매 창고 전체의 합이라
 * 판매 창고가 하나(부천)일 때만 "이 창고의 예정 물량" 과 같다. 둘 이상이 되면 같은 수량이 모든
 * 판매 창고에 중복 표시된다 — ①은 계획의 destination_warehouse_id 로 좁힐 여지가 있지만, ②는
 * 이동 지시서가 생기기 전 구간이라 목적지 링크 자체가 없어 구조적으로 좁힐 수 없다.
 */
@Injectable()
export class InboundPipelineReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly transferReader: WarehouseTransferReader,
  ) {}

  /** 요청한 SKU 마다 한 행. 파이프라인이 비어 있는 SKU 도 0 으로 낸다 — 빠지면 화면이 그 칸을 못 그린다. */
  async read(tx: DbTx, input: { skuIds: string[]; toWarehouseId: string }): Promise<InboundPipelineRow[]> {
    const skuIds = [...new Set(input.skuIds)];
    if (skuIds.length === 0) return [];

    return this.dbService.run(async (trx) => {
      const onOrder = await this.readOnOrder(trx, skuIds);
      const awaiting = await this.readAwaitingTransfer(trx, skuIds);
      const inTransit = await this.readInTransit(trx, skuIds, input.toWarehouseId);

      return skuIds.map((skuId) => ({
        skuId,
        onOrderQty: onOrder.get(skuId)?.qty ?? 0,
        onOrderEta: onOrder.get(skuId)?.eta ?? null,
        awaitingTransferQty: awaiting.get(skuId) ?? 0,
        inTransitQty: inTransit.get(skuId)?.qty ?? 0,
        inTransitEta: inTransit.get(skuId)?.eta ?? null,
      }));
    }, tx);
  }

  /** ① 아직 중국에도 안 들어온 발주 잔량. 예정일은 가장 이른 계획일. */
  private async readOnOrder(trx: DbTx, skuIds: string[]): Promise<Map<string, QtyWithEta>> {
    const items = wmsTables.inboundPlanItems;
    const plans = wmsTables.inboundPlans;

    const rows = await trx
      .select({
        skuId: items.skuId,
        qty: sql<number>`SUM(${items.expectedQty} - ${items.receivedQty})::int`,
        // 예정일의 진실은 아이템이다 — 라인마다 ETA 가 다를 수 있는데 계획 날짜는
        // 계획 단위라 그걸 담지 못한다. 아이템 예정일이 없으면(수동 생성 계획 등)
        // 계획 날짜로 떨어진다. `date` 컬럼이라 드라이버가 'YYYY-MM-DD' 를 준다.
        eta: sql<string | null>`MIN(${items.expectedDate})`,
      })
      .from(items)
      .innerJoin(plans, eq(plans.id, items.planId))
      .where(
        and(
          eq(items.status, 'pending'),
          // 입고될 창고 기준이다 — 최종 목적지(destination_warehouse_id)로 집계하면
          // Task 7 이 닫은 이중 계상이 되살아난다. 판매 창고로 바로 들어오는 국내 발주
          // (planType='destination')는 ①이 아니다 — 그건 이미 입고예정에 잡힌다.
          not(inSellableWarehouse(plans.warehouseId)),
          inArray(items.skuId, skuIds),
        ),
      )
      .groupBy(items.skuId);

    // 'YYYY-MM-DD' 는 UTC 자정으로 결정적으로 파싱된다 — TZ 함정이 없다.
    return new Map(rows.map((row) => [row.skuId, { qty: Number(row.qty), eta: row.eta ? new Date(row.eta) : null }]));
  }

  /** ② 비판매 창고에 도착해 있으나 아직 이동 지시서에 실리지 않은 물량. 예정일이라 할 것이 없다. */
  private async readAwaitingTransfer(trx: DbTx, skuIds: string[]): Promise<Map<string, number>> {
    const ledgers = wmsTables.stockLedgers;

    const rows = await trx
      .select({
        skuId: ledgers.skuId,
        qty: sql<number>`SUM(${ledgers.qty})::int`,
      })
      .from(ledgers)
      .where(
        and(
          eq(ledgers.stockState, 'ON_HAND'),
          not(inSellableWarehouse(ledgers.warehouseId)),
          inArray(ledgers.skuId, skuIds),
        ),
      )
      .groupBy(ledgers.skuId);

    return new Map(rows.map((row) => [row.skuId, Number(row.qty)]));
  }

  /**
   * ③ 떠났으나 아직 도착·분실 정산이 안 된 잔량.
   *
   * 잔량 식(shipped − received − lost)은 `WarehouseTransferReader.findOutstanding` 이
   * 소유한다 — 여기서 같은 뺄셈을 다시 쓰면 두 벌이 갈라진다. 열린 지시서 라인만 도는
   * 조회라 여기서 창고·SKU 로 좁혀도 비용이 문제되지 않는다.
   */
  private async readInTransit(trx: DbTx, skuIds: string[], toWarehouseId: string): Promise<Map<string, QtyWithEta>> {
    const wanted = new Set(skuIds);
    const outstanding = await this.transferReader.findOutstanding(trx);

    const bySku = new Map<string, QtyWithEta>();
    for (const line of outstanding) {
      if (line.toWarehouseId !== toWarehouseId || !wanted.has(line.skuId)) continue;
      const current = bySku.get(line.skuId) ?? { qty: 0, eta: null };
      bySku.set(line.skuId, {
        qty: current.qty + line.outstandingQty,
        // 가장 이른 도착 예정일. ETA 가 없는 지시서는 예정일을 늦추지 않는다.
        eta: earliest(current.eta, line.eta),
      });
    }
    return bySku;
  }
}

function earliest(left: Date | null, right: Date | null): Date | null {
  if (!left) return right;
  if (!right) return left;
  return left <= right ? left : right;
}
