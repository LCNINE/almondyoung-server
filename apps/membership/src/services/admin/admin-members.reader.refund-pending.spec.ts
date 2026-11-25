import { drizzle } from 'drizzle-orm/pg-proxy';
import type { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import { AdminMembersReader } from './admin-members.reader';

it.each([true, false])('refundPending=%s 목록과 total의 결제 이력 필터가 일치한다', async (refundPending) => {
  const queries: string[] = [];
  const db = drizzle(
    (query) => {
      queries.push(query);

      return Promise.resolve({ rows: query.includes('count(*)') ? [[0]] : [] });
    },
    { schema: membershipSchema },
  );
  const reader = new AdminMembersReader(
    { db } as unknown as DbService<typeof membershipSchema>,
    {} as never,
    {} as never,
    {} as never,
  );

  await expect(reader.findAllWithDetails({ page: 1, limit: 1, refundPending })).resolves.toMatchObject({
    data: [],
    total: 0,
  });

  expect(queries).toHaveLength(2);

  for (const query of queries) {
    expect(query.includes('"subscription_contracts"."last_payment_intent_id" is not null')).toBe(refundPending);
    expect(query.includes('"subscription_contracts"."refund_requested" =')).toBe(refundPending);
    expect(query.includes('"subscription_contracts"."refund_completed" =')).toBe(refundPending);
  }
});

it.each([undefined, 'contract-1'])('상세 조회는 contractId=%s 일 때만 그 계약으로 좁힌다', async (contractId) => {
  const queries: { sql: string; params: unknown[] }[] = [];
  const db = drizzle(
    (sql, params) => {
      queries.push({ sql, params });

      return Promise.resolve({ rows: [] });
    },
    { schema: membershipSchema },
  );
  const reader = new AdminMembersReader(
    { db } as unknown as DbService<typeof membershipSchema>,
    {} as never,
    {} as never,
    {} as never,
  );

  await expect(reader.findDetailByUserId('user-1', contractId)).resolves.toBeNull();

  expect(queries).toHaveLength(1);
  expect(queries[0].sql.includes('"subscription_contracts"."id" =')).toBe(!!contractId);
  expect(queries[0].params.includes('contract-1')).toBe(!!contractId);
});
