import { sql, SQL, SQLWrapper, eq } from 'drizzle-orm';
import { BadRequestError } from '@app/shared';
import { DbTx, wmsTables } from '../../schema/inventory.schema';

/**
 * 판매 대상 창고 판정의 유일한 정의.
 *
 * 창고 재고가 storefront 판매가능수량에 들어가는지, 그 창고로 출고를 지시할 수 있는지를
 * 여기서만 판단한다. 다른 곳에서 `type = 'domestic'` 같은 우회 판정을 쓰지 않는다.
 *
 * 알려진 확장 지점: 장차 채널별 판매성(중국몰↔중국 창고)이 필요해지면 이 boolean 이
 * (warehouse × sales_channel) M:N 이 된다. 그때의 진짜 제약은 컬럼 모양이 아니라
 * ADR-0011(모든 판매채널이 같은 수량을 공유한다)이며, 바뀌는 코드는 이 파일로 국한된다.
 *
 * Nest 프로바이더가 아니라 순수 leaf 다 — warehouse-availability.ts 가 택한 형태를 따른다.
 */
// SQLWrapper 로 받는다 — 호출자가 테이블 컬럼(warehouses.id)일 수도, 뷰 컬럼
// (stock_summary_view.warehouse_id)일 수도 있어 PgColumn 으로 좁히면 뷰에서 타입이 안 맞는다.
export function inSellableWarehouse(warehouseIdColumn: SQLWrapper): SQL {
  return sql`${warehouseIdColumn} IN (SELECT id FROM warehouses WHERE is_sellable = true)`;
}

/** 출고 지시 대상으로 쓸 수 있는 창고인지. 비판매 창고면 던진다. */
export async function assertWarehouseSellable(trx: DbTx, warehouseId: string): Promise<void> {
  const [row] = await trx
    .select({ isSellable: wmsTables.warehouses.isSellable })
    .from(wmsTables.warehouses)
    .where(eq(wmsTables.warehouses.id, warehouseId))
    .limit(1);

  if (!row) {
    throw new BadRequestError(`Warehouse ${warehouseId} not found`);
  }
  if (!row.isSellable) {
    throw new BadRequestError(`Warehouse ${warehouseId} is not a sellable warehouse`);
  }
}
