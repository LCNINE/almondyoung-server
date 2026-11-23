import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/pg-proxy';
import { SalesOrderFilterDto } from '../dto/sales-order-filter.dto';
import { SalesOrdersService } from './sales-orders.service';

const cases: { filter: SalesOrderFilterDto; channels: string[] }[] = [
  { filter: { channels: ['naver', 'coupang'] }, channels: ['naver', 'coupang'] },
  { filter: { channel: 'medusa' }, channels: ['medusa'] },
  { filter: { channel: 'medusa', channels: ['naver', 'coupang'] }, channels: ['naver', 'coupang', 'medusa'] },
  { filter: { channel: 'naver', channels: ['naver', 'naver', 'coupang'] }, channels: ['naver', 'coupang'] },
  { filter: { channels: [] }, channels: [] },
  { filter: {}, channels: [] },
];

describe('SalesOrdersService.list 판매처 SQL', () => {
  it.each(cases)('$filter 조건을 목록과 두 건수 쿼리에 동일하게 적용한다', async ({ filter, channels }) => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const db = drizzle(async (sql, params) => {
      queries.push({ sql, params });

      return { rows: sql.includes('count(*)') ? [[0]] : [] };
    });
    const module = await Test.createTestingModule({ providers: [SalesOrdersService] })
      .useMocker(() => ({ run: (fn: (tx: typeof db) => Promise<unknown>) => fn(db) }))
      .compile();

    try {
      await module.get(SalesOrdersService).list(filter);

      expect(queries).toHaveLength(3);

      for (const query of queries) {
        if (channels.length > 0) {
          expect(query.sql).toContain('"sales_orders"."sales_channel" in (');
          expect(query.params.slice(0, channels.length)).toEqual(channels);
        } else {
          expect(query.sql).not.toContain(' where ');
        }
      }
    } finally {
      await module.close();
    }
  });
});
