import { eq, getTableName, inArray, sql, type Column, type Table } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { InboundPipelineRow } from '../../inventory/stock-projection/services/inbound-pipeline.reader';

export interface ShortageIncoming {
  // 이 창고로 오는 이동 지시 잔량
  inTransit: number;
  inTransitEta: string | null;
  // 이 창고로 바로 들어오는 발주 잔량
  ordered: number;
  // 이 창고로 오는 선적 잔량
  inboundShipment: number;
  inboundShipmentEta: string | null;
}

export interface ShortageElsewhere {
  // 다른(판매하지 않는) 창고에 있고 아직 옮기지 않은 수량
  onHand: number;
  // 다른 창고로 들어올 발주 잔량
  ordered: number;
  orderedEta: string | null;
}

export interface ShortageStock {
  // 이 창고 ON_HAND 원장 합
  onHand: number;
  // 그중 다른 상자가 잡은 수량(confirmed 예약 합)
  reservedByOthers: number;
  // 아직 어느 상자도 잡지 않은 수량
  available: number;
  // 이 창고로 오는 것은 판매 창고가 이 창고 하나일 때만, 다른 창고에 있는 것은 이 창고가 판매 창고일 때만 안다. 모르면 null
  incoming: ShortageIncoming | null;
  elsewhere: ShortageElsewhere | null;
}

// 단일 테이블 select 에서 drizzle 은 컬럼의 테이블 한정자를 떼므로, 서브쿼리 안의 컬럼은 테이블 이름을 직접 적는다
const qualified = (table: Table, column: Column) =>
  sql`${sql.identifier(getTableName(table))}.${sql.identifier(column.name)}`;

/** 이 창고의 SKU 별 ON_HAND 합과 confirmed 예약 합을 한 statement 로 읽는다(가용 = 둘의 차, 판독 규칙과 같다). */
export async function loadWarehouseStock(
  trx: DbTx,
  warehouseId: string,
  skuIds: string[],
): Promise<Map<string, { onHand: number; reserved: number }>> {
  if (skuIds.length === 0) {
    return new Map();
  }

  const { skus, stockLedgers: ledgers, stockReservations: reservations } = wmsTables;
  const skuId = qualified(skus, skus.id);
  const rows = await trx
    .select({
      skuId: skus.id,
      onHand: sql<number>`COALESCE((SELECT SUM(${qualified(ledgers, ledgers.qty)}) FROM ${ledgers} WHERE ${qualified(ledgers, ledgers.skuId)} = ${skuId} AND ${qualified(ledgers, ledgers.warehouseId)} = ${warehouseId} AND ${qualified(ledgers, ledgers.stockState)} = 'ON_HAND'), 0)::int`,
      reserved: sql<number>`COALESCE((SELECT SUM(${qualified(reservations, reservations.quantity)}) FROM ${reservations} WHERE ${qualified(reservations, reservations.skuId)} = ${skuId} AND ${qualified(reservations, reservations.warehouseId)} = ${warehouseId} AND ${qualified(reservations, reservations.status)} = 'confirmed'), 0)::int`,
    })
    .from(skus)
    .where(inArray(skus.id, skuIds));

  return new Map(rows.map((row) => [row.skuId, { onHand: Number(row.onHand), reserved: Number(row.reserved) }]));
}

/**
 * 공급 파이프라인으로 이 창고에 대해 무엇을 알 수 있는가. 판매하지 않는 창고 보유·발주(다른 창고)는 판매 창고이면 알고,
 * 이 창고로 오는 수량(판매 창고 축)은 판매 창고가 이 창고 하나일 때만 이 창고의 수량과 같다.
 */
export async function readPipelineScope(
  trx: DbTx,
  warehouseId: string,
): Promise<{ incoming: boolean; elsewhere: boolean }> {
  const [row] = await trx
    .select({
      sellable: wmsTables.warehouses.isSellable,
      sellableCount: sql<number>`(SELECT COUNT(*) FROM ${wmsTables.warehouses} WHERE ${qualified(wmsTables.warehouses, wmsTables.warehouses.isSellable)})::int`,
    })
    .from(wmsTables.warehouses)
    .where(eq(wmsTables.warehouses.id, warehouseId));
  const sellable = row?.sellable === true;

  return { incoming: sellable && Number(row.sellableCount) === 1, elsewhere: sellable };
}

/**
 * 보충 제안의 판매 창고 축과 같은 항목으로 나눈다: 이 창고로 오는 것(이동 중·직배 발주·선적)과
 * 아직 다른 창고에 있거나 그쪽으로 들어올 것(이동 대기·해외 발주). 모르는 쪽은 null 이다.
 */
export function shortageStockOf(
  stock: { onHand: number; reserved: number } | undefined,
  pipeline: InboundPipelineRow | undefined,
  ownReservedQty: number,
  scope: { incoming: boolean; elsewhere: boolean },
): ShortageStock {
  return {
    onHand: stock?.onHand ?? 0,
    reservedByOthers: Math.max(0, (stock?.reserved ?? 0) - ownReservedQty),
    available: Math.max(0, (stock?.onHand ?? 0) - (stock?.reserved ?? 0)),
    incoming: scope.incoming
      ? {
          inTransit: pipeline?.inTransitQty ?? 0,
          inTransitEta: dateText(pipeline?.inTransitEta ?? null),
          ordered: Math.max(0, (pipeline?.onOrderTotalQty ?? 0) - (pipeline?.onOrderQty ?? 0)),
          inboundShipment: pipeline?.inboundShipmentToSellableQty ?? 0,
          inboundShipmentEta: pipeline?.inboundShipmentEta ?? null,
        }
      : null,
    elsewhere: scope.elsewhere
      ? {
          onHand: pipeline?.awaitingTransferQty ?? 0,
          ordered: pipeline?.onOrderQty ?? 0,
          orderedEta: dateText(pipeline?.onOrderEta ?? null),
        }
      : null,
  };
}

function dateText(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}
