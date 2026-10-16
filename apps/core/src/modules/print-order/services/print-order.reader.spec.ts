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

  it('compares the line quantity with the partial cancellations of that line', () => {
    expect(rendered).toContain(`"sales_order_lines"."quantity" > coalesce((`);
    expect(rendered).toContain(`"sales_order_cancellations"."sales_order_id" = "print_orders"."sales_order_id"`);
    expect(rendered).toContain(`"sales_order_cancellations"."cancellation_scope" = 'partial'`);
    expect(rendered).toContain(`cl.value->>'salesOrderLineId' = ("sales_order_lines"."id")::text`);
  });
});
