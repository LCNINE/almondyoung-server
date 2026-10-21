import { PgDialect } from 'drizzle-orm/pg-core';
import { phoneDigits, refundNotOpenedSql } from './print-order.reader';

const PHONE_SAMPLES: Array<[string, string]> = [
  ['010-1234-5678', '01012345678'],
  ['010 1234 5678', '01012345678'],
  ['+82 10-1234-5678', '01012345678'],
  ['821012345678', '01012345678'],
  ['+82-2-123-4567', '021234567'],
  ['02-123-4567', '021234567'],
  ['8212', '8212'],
  ['1234-5678', '12345678'],
  ['홍길동', ''],
];

describe('phoneDigits', () => {
  it.each(PHONE_SAMPLES)('%s → %s', (input, expected) => {
    expect(phoneDigits(input)).toBe(expected);
  });
});

describe('refundNotOpenedSql', () => {
  const rendered = new PgDialect().sqlToQuery(refundNotOpenedSql()).sql.replace(/\s+/g, ' ');

  it('is a cancelled print row whose sales order is not cancelled, regardless of the line status', () => {
    expect(rendered).toContain(`"print_orders"."status" = 'cancelled'`);
    expect(rendered).toContain(`"sales_orders"."status" <> 'cancelled'`);
    expect(rendered).not.toContain(`"sales_order_lines"."status"`);
  });

  // K6 PR2a — 취소 수량은 취소 라인 행에서, 갈래(출고 전/후)·범위(partial/full) 무관 합으로 읽는다(E1)
  it('compares the line quantity with every cancellation line row of that line', () => {
    expect(rendered).toContain(`"sales_order_lines"."quantity" > coalesce((`);
    expect(rendered).toContain(`from "sales_order_cancellation_lines"`);
    expect(rendered).toContain(`k6_cl.k6_line_id = "sales_order_lines"."id" ), 0)::int`);
    expect(rendered).not.toContain('k6_shipment_phase =');
    expect(rendered).not.toContain('cancellation_scope');
    expect(rendered).not.toContain('cancelledLines');
  });
});
