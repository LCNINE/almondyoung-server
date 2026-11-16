/**
 * 저녁 맞추기 통합 스펙이 같이 쓰는 시드 도우미 (reconcile-store·evening-reconcile 통합 스펙).
 * 픽스처 값은 TEST- 접두사만 쓴다(공개 레포).
 */
import type { Sql } from 'postgres';
import { BUCHEON_RECEIVING_LOC_ID, BUCHEON_WAREHOUSE_ID } from '../../stock-delta';

let n = 0;
export const uid = (): string => `${Date.now().toString(36)}${(n++).toString(36)}`;

export async function seedWarehouse(tx: Sql): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO warehouses (name, type) VALUES (${'TEST-WH-' + uid()}, 'domestic') RETURNING id`;
  return row.id;
}

export async function ensureBucheon(tx: Sql): Promise<void> {
  await tx`INSERT INTO warehouses (id, name, type) VALUES (${BUCHEON_WAREHOUSE_ID}, 'TEST-BUCHEON', 'domestic') ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO locations (id, warehouse_id, code, location_type, is_system, system_role)
    VALUES (${BUCHEON_RECEIVING_LOC_ID}, ${BUCHEON_WAREHOUSE_ID}, 'TEST-RECV', 'zone', true, 'inbound_default')
    ON CONFLICT (id) DO NOTHING`;
}

export async function seedZone(tx: Sql, warehouseId: string): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO locations (warehouse_id, code, location_type) VALUES (${warehouseId}, ${'TEST-Z-' + uid()}, 'zone') RETURNING id`;
  return row.id;
}

/** code 를 주면 그 값으로(셀메이트 옵션정보일련번호와 짝짓기용), 없으면 TEST-<uid> */
export async function seedSku(tx: Sql, code: string = 'TEST-' + uid()): Promise<string> {
  const [holder] = await tx<{ id: string }[]>`INSERT INTO holders (name) VALUES ('TEST-HOLDER') RETURNING id`;
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO skus (holder_id, name, code) VALUES (${holder.id}, 'TEST-ITEM', ${code}) RETURNING id`;
  return row.id;
}

export async function seedLedger(
  tx: Sql,
  skuId: string,
  warehouseId: string,
  locationId: string,
  qty: number,
): Promise<void> {
  await tx`INSERT INTO stock_ledgers (sku_id, warehouse_id, location_id, stock_state, qty)
    VALUES (${skuId}, ${warehouseId}, ${locationId}, 'ON_HAND', ${qty})`;
}

export async function seedSalesOrder(tx: Sql, channelOrderId = 'TEST-ORD-' + uid()): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO sales_orders (channel_order_id, sales_channel, shipping_address, order_date)
    VALUES (${channelOrderId}, 'medusa', '{}'::json, now()) RETURNING id`;
  return row.id;
}
