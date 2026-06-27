import { PgDialect } from 'drizzle-orm/pg-core';

import { LibraryService } from './library.service';
import { digitalAssetOwnerships } from '../schema/library.schema';

/**
 * Grant 흐름의 행동을 fake tx 로 단위 검증한다.
 *
 * 검증 포인트:
 *  - SO 없으면 0 반환
 *  - SO.customerId 없으면 0 반환 (비-로그인 채널)
 *  - line 없거나 매칭 asset 없으면 0 반환
 *  - 매칭 있으면 (customerId, assetId, salesOrderId) 조합으로 insert
 *  - 중복 변종을 dedupe 후 insert
 *  - revoke 는 exercise 전 + 미revoke 만 대상
 */
describe('LibraryService', () => {
  type FakeRows = {
    order?: { id: string; customerId: string | null };
    lines?: Array<{ variantId: string }>;
    links?: Array<{ assetId: string }>;
  };

  function makeFakeTx(rows: FakeRows) {
    const inserts: Array<{ table: any; values: any; conflictTarget?: any }> = [];
    const updates: Array<{ table: any; set: any; where: any; returning: any[] }> = [];

    // sequence of select() calls: order → lines → links
    let selectCallCount = 0;

    const tx: any = {
      select: (_cols?: any) => {
        const idx = selectCallCount++;
        return {
          from: (_t: any) => ({
            where: (_w: any) => {
              if (idx === 0) return rows.order ? [rows.order] : [];
              if (idx === 1) return rows.lines ?? [];
              if (idx === 2) return rows.links ?? [];
              return [];
            },
          }),
        };
      },
      insert: (table: any) => ({
        values: (values: any) => {
          const node: any = {
            onConflictDoNothing: (opts?: any) => {
              node._conflict = opts;
              return node;
            },
            returning: () => {
              inserts.push({ table, values, conflictTarget: node._conflict });
              // simulate: return all inserted rows
              return Array.isArray(values)
                ? values.map((_: any, i: number) => ({ id: `ow-${i}` }))
                : [{ id: 'ow-0' }];
            },
          };
          return node;
        },
      }),
      update: (table: any) => ({
        set: (set: any) => ({
          where: (whereExpr: any) => ({
            returning: () => {
              const returned = [{ id: 'r-1' }, { id: 'r-2' }];
              updates.push({ table, set, where: whereExpr, returning: returned });
              return returned;
            },
          }),
        }),
      }),
    };

    return { tx, inserts, updates };
  }

  function makeService(): LibraryService {
    const fakeDbService: any = { db: {}, run: (fn: any, tx?: any) => fn(tx) };
    return new LibraryService(fakeDbService);
  }

  it('grant — SO 없으면 0 반환, insert 안 함', async () => {
    const svc = makeService();
    const { tx, inserts } = makeFakeTx({ order: undefined });
    const count = await svc.grantOwnershipsForOrder('so-1', tx);
    expect(count).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  it('grant — customerId 가 NULL 이면 0 반환 (비-로그인 채널)', async () => {
    const svc = makeService();
    const { tx, inserts } = makeFakeTx({
      order: { id: 'so-1', customerId: null },
    });
    const count = await svc.grantOwnershipsForOrder('so-1', tx);
    expect(count).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  it('grant — line 없으면 0 반환', async () => {
    const svc = makeService();
    const { tx, inserts } = makeFakeTx({
      order: { id: 'so-1', customerId: 'cust-1' },
      lines: [],
    });
    const count = await svc.grantOwnershipsForOrder('so-1', tx);
    expect(count).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  it('grant — variant 에 asset 매칭 없으면 0 반환', async () => {
    const svc = makeService();
    const { tx, inserts } = makeFakeTx({
      order: { id: 'so-1', customerId: 'cust-1' },
      lines: [{ variantId: 'v-1' }],
      links: [],
    });
    const count = await svc.grantOwnershipsForOrder('so-1', tx);
    expect(count).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  it('grant — 매칭 있으면 unique 한 assetId 별로 ownership row 삽입', async () => {
    const svc = makeService();
    const { tx, inserts } = makeFakeTx({
      order: { id: 'so-1', customerId: 'cust-1' },
      lines: [{ variantId: 'v-1' }, { variantId: 'v-1' }], // 중복 variant
      links: [
        { assetId: 'a-1' },
        { assetId: 'a-2' },
        { assetId: 'a-2' }, // 중복 asset
      ],
    });

    const count = await svc.grantOwnershipsForOrder('so-1', tx);

    expect(count).toBe(2);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe(digitalAssetOwnerships);
    expect(inserts[0].values).toEqual([
      { customerId: 'cust-1', assetId: 'a-1', salesOrderId: 'so-1' },
      { customerId: 'cust-1', assetId: 'a-2', salesOrderId: 'so-1' },
    ]);
    // 멱등성을 위한 ON CONFLICT 가 적용돼야 함
    expect(inserts[0].conflictTarget).toBeDefined();
  });

  it('revoke — exercise 전 ownership 에 revokedAt + reason 세팅', async () => {
    const svc = makeService();
    const { tx, updates } = makeFakeTx({});

    const count = await svc.revokeOwnershipsForOrder('so-1', 'CUSTOMER_REQUEST', tx);

    expect(count).toBe(2);
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe(digitalAssetOwnerships);
    expect(updates[0].set.revokedReason).toBe('CUSTOMER_REQUEST');
    expect(updates[0].set.revokedAt).toBeInstanceOf(Date);
  });

  // 이슈 #353: exercise 후 ownership 은 회수되지 않아야 한다 (환불 가부는 결제 측이 결정).
  // fake tx 가 SQL 평가를 흉내내지 못하므로, drizzle 의 PgDialect 로 WHERE 절을 실제 SQL
  // 문자열로 풀어서 `exercised_at is null` predicate 가 포함됐는지 검증한다 —
  // 이게 빠지면 exercise 된 row 도 update 대상이 된다.
  it('revoke — WHERE 절이 (salesOrderId 일치 AND exercised_at IS NULL AND revoked_at IS NULL) 로 빌드된다', async () => {
    const svc = makeService();
    const { tx, updates } = makeFakeTx({});

    await svc.revokeOwnershipsForOrder('so-1', 'CUSTOMER_REQUEST', tx);

    expect(updates).toHaveLength(1);
    const { sql } = new PgDialect().sqlToQuery(updates[0].where);
    // 정규화: drizzle 가 column 을 따옴표로 감싸 출력. 공백 변동에 관대하게.
    const normalized = sql.replace(/\s+/g, ' ');
    expect(normalized).toMatch(/"sales_order_id"\s*=\s*\$\d+/);
    expect(normalized).toMatch(/"exercised_at"\s+is\s+null/i);
    expect(normalized).toMatch(/"revoked_at"\s+is\s+null/i);
  });
});
