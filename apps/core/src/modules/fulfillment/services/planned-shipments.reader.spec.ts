import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { wmsSchema } from '../../inventory/schema/inventory.schema';
import { PgDialect } from 'drizzle-orm/pg-core';
import { assemblePlannedShipments, plannedShipmentCondition } from './planned-shipments.reader';
import { OptionLine } from './consolidation-shipment-reads';

function line(shipmentId: string, qty: number, patch: Partial<OptionLine> = {}): OptionLine {
  return {
    shipmentId,
    qty,
    salesOrderId: 'so',
    fulfillmentMode: 'in_house',
    skuStockType: 'stocked',
    skuProfileId: 'p1',
    skuName: 'sku',
    customerId: null,
    customerName: null,
    customerPhone: null,
    displayOrderNo: null,
    channelOrderId: null,
    salesChannel: null,
    salesOrderCreatedAt: null,
    ...patch,
  };
}

describe('assemblePlannedShipments', () => {
  it('상자마다 주문번호와 수량 합을 돌려준다', () => {
    const result = assemblePlannedShipments(
      ['a', 'b'],
      [
        line('a', 2, { displayOrderNo: '6321' }),
        line('a', 3, { displayOrderNo: '6321' }),
        line('b', 1, { channelOrderId: 'CH-9' }),
      ],
    );

    expect(result).toEqual([
      { shipmentId: 'a', orderNos: ['6321'], totalQty: 5 },
      { shipmentId: 'b', orderNos: ['CH-9'], totalQty: 1 },
    ]);
  });

  it('표시할 주문번호가 없어도 상자는 빠지지 않는다', () => {
    expect(assemblePlannedShipments(['a', 'c'], [line('a', 1)])).toEqual([
      { shipmentId: 'a', orderNos: [], totalQty: 1 },
      { shipmentId: 'c', orderNos: [], totalQty: 0 },
    ]);
  });
});

describe('plannedShipmentCondition', () => {
  it('끝나지 않은 운송장이 있는 상자를 뺀다', () => {
    const db = drizzle(postgres('postgres://unused:unused@127.0.0.1:1/unused'), { schema: wmsSchema });
    const condition = plannedShipmentCondition(db, 'w1');

    if (!condition) throw new Error('condition');

    const query = new PgDialect().sqlToQuery(condition);

    expect(query.sql).toMatch(/not exists \(select/i);
    expect(query.sql).toContain('"waybills"');
    expect(query.params).toEqual(expect.arrayContaining(['w1', 'planned', 'voided', 'failed', 'abandoned']));
  });
});
