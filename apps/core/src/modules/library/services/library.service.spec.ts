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
    const updates: Array<{ table: any; set: any; returning: any[] }> = [];

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
          where: (_w: any) => ({
            returning: () => {
              const returned = [{ id: 'r-1' }, { id: 'r-2' }];
              updates.push({ table, set, returning: returned });
              return returned;
            },
          }),
        }),
      }),
    };

    return { tx, inserts, updates };
  }

  function makeService(): LibraryService {
    const fakeDbService: any = { db: {} };
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
});
