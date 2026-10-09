import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { judgedShipmentsSql } from '../order-progress/order-progress.judge-sql';
import { JudgedShipmentRow } from '../order-progress/order-progress.reader';
import { SHIPMENT_EXCLUDED_ORDER_RULES, inSituationShipmentIds, shipmentInSituation } from './order-reconcile.subject';

const SIT = { stage: 'pick', states: ['CONSOLIDATION_PENDING'] } as const;
const row = (over: Partial<JudgedShipmentRow> = {}): JudgedShipmentRow => ({
  shipmentId: 's',
  stage: 'pick',
  state: 'CONSOLIDATION_PENDING',
  estimatedEnteredAt: '2000-01-01T00:00:00.000Z',
  salesOrderIds: ['o'],
  orderRules: ['unit'],
  ...over,
});

describe('shipmentInSituation', () => {
  it('단계·세부 상태가 칸과 같고 제외 주문이 없으면 칸 안', () => {
    expect(shipmentInSituation(SIT, row())).toBe(true);
  });

  it('판정에 없는 상자(취소·대체됨)·다른 단계·다른 세부 상태·state 없음은 칸 밖', () => {
    expect(shipmentInSituation(SIT, undefined)).toBe(false);
    expect(shipmentInSituation(SIT, row({ stage: 'plan' }))).toBe(false);
    expect(shipmentInSituation(SIT, row({ state: 'queued' }))).toBe(false);
    expect(shipmentInSituation(SIT, row({ state: null }))).toBe(false);
  });

  it.each([...SHIPMENT_EXCLUDED_ORDER_RULES])('상자의 주문 중 하나라도 %s 이면 칸 밖(D16)', (rule) => {
    expect(shipmentInSituation(SIT, row({ orderRules: ['unit', rule] }))).toBe(false);
  });

  it('취소된 주문(cancel_open·cancelled)은 제외하지 않는다 — 30번이 다룬다', () => {
    expect(shipmentInSituation(SIT, row({ orderRules: ['cancel_open', 'cancelled', 'unit'] }))).toBe(true);
  });
});

describe('inSituationShipmentIds', () => {
  it('칸 안인 상자만, 단계 진입 오래된 순(추정 시각 없음은 뒤), 같으면 id 순', () => {
    const rows = [
      row({ shipmentId: 'c', estimatedEnteredAt: null }),
      row({ shipmentId: 'b', estimatedEnteredAt: '2000-01-02T00:00:00.000Z' }),
      row({ shipmentId: 'x', orderRules: ['external_shipped'] }),
      row({ shipmentId: 'a', estimatedEnteredAt: '2000-01-02T00:00:00.000Z' }),
      row({ shipmentId: 'd', estimatedEnteredAt: '2000-01-01T00:00:00.000Z' }),
      row({ shipmentId: 'e', state: 'queued' }),
    ];
    expect(inSituationShipmentIds(rows, SIT)).toEqual(['d', 'a', 'b', 'c']);
  });
});

describe('D16 제외 목록', () => {
  it('목록의 값은 판정 SQL 이 주문 판정으로 실제로 내는 값이다 — 오타면 제외가 조용히 사라진다', () => {
    const text = new PgDialect().sqlToQuery(judgedShipmentsSql(sql`SELECT NULL::uuid`, '2000-01-01T00:00:00.000Z')).sql;
    expect(SHIPMENT_EXCLUDED_ORDER_RULES.filter((r) => !text.includes(`THEN '${r}'`))).toEqual([]);
  });
});
