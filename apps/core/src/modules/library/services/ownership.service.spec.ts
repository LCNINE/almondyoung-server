import { PgDialect } from 'drizzle-orm/pg-core';

import { OwnershipService } from './ownership.service';

/**
 * 다운로드가 항상 asset.currentFileVersionId 가 가리키는 fileId 로 라우팅되는지를
 * 단위 테스트로 보장한다 (이슈 #352 의 핵심 받아들임 조건).
 *
 * 검증 포인트:
 *  - exercise 안 된 ownership 은 다운로드 불가 (ForbiddenError)
 *  - currentFileVersion 이 v1 이면 fileId 도 v1 의 것
 *  - currentFileVersion 이 v2 로 바뀌면 fileId 도 자동으로 v2 의 것
 *    (= 기존 ownership 보유자가 v2 파일을 받는다)
 *  - rollback 으로 currentFileVersion 이 v1 으로 되돌아가면 fileId 도 v1 으로
 *  - rollback 후에도 이전 version row (= 옛 fileId 매핑) 는 그대로 남아 있다는
 *    가정에서 동작 — 본 서비스는 version row 를 절대 삭제하지 않는다.
 */
describe('OwnershipService.getDownloadable — currentFileVersionId 라우팅 (이슈 #352)', () => {
  type FileVersion = { id: string; fileId: string };
  type Ownership = {
    id: string;
    customerId: string;
    exercisedAt: Date | null;
    revokedAt: Date | null;
  };
  type Asset = {
    id: string;
    name: string;
    mimeType: string | null;
    currentFileVersionId: string | null;
  };

  function makeFakeTx(state: {
    ownership: Ownership;
    asset: Asset;
    versions: FileVersion[];
  }) {
    let selectCallCount = 0;

    const tx: any = {
      select: (_cols?: any) => ({
        from: (_t: any) => ({
          innerJoin: () => ({
            where: () => {
              // _loadOwnedOrThrow's joined select — return [{ ownership, asset }]
              selectCallCount++;
              return [{ ownership: state.ownership, asset: state.asset }];
            },
          }),
          where: () => {
            // file version lookup
            selectCallCount++;
            const id = state.asset.currentFileVersionId;
            const v = state.versions.find((x) => x.id === id);
            return v ? [{ fileId: v.fileId }] : [];
          },
        }),
      }),
    };
    return { tx, getSelectCount: () => selectCallCount };
  }

  function makeService(): OwnershipService {
    const fakeDb: any = { db: {} };
    return new OwnershipService(fakeDb);
  }

  const CUSTOMER = 'c-1';
  const OWNERSHIP_ID = 'o-1';
  const ASSET_ID = 'a-1';
  const V1 = { id: 'v-1', fileId: 'f-v1' };
  const V2 = { id: 'v-2', fileId: 'f-v2' };

  it('exercise 안 된 ownership 은 ForbiddenError', async () => {
    const service = makeService();
    const { tx } = makeFakeTx({
      ownership: { id: OWNERSHIP_ID, customerId: CUSTOMER, exercisedAt: null, revokedAt: null },
      asset: { id: ASSET_ID, name: 'x', mimeType: null, currentFileVersionId: V1.id },
      versions: [V1],
    });
    await expect(service.getDownloadable(OWNERSHIP_ID, CUSTOMER, tx)).rejects.toThrow(
      /not exercised/,
    );
  });

  it('exercise 된 ownership: currentFileVersion=v1 → v1.fileId 반환', async () => {
    const service = makeService();
    const { tx } = makeFakeTx({
      ownership: {
        id: OWNERSHIP_ID,
        customerId: CUSTOMER,
        exercisedAt: new Date(),
        revokedAt: null,
      },
      asset: { id: ASSET_ID, name: 'x', mimeType: 'application/pdf', currentFileVersionId: V1.id },
      versions: [V1, V2],
    });
    const result = await service.getDownloadable(OWNERSHIP_ID, CUSTOMER, tx);
    expect(result.fileId).toBe('f-v1');
  });

  it('v2 등록 후: currentFileVersion=v2 → v2.fileId 반환 (기존 ownership 보유자도 자동 최신본)', async () => {
    const service = makeService();
    const { tx } = makeFakeTx({
      ownership: {
        id: OWNERSHIP_ID,
        customerId: CUSTOMER,
        exercisedAt: new Date(),
        revokedAt: null,
      },
      asset: { id: ASSET_ID, name: 'x', mimeType: null, currentFileVersionId: V2.id },
      versions: [V1, V2],
    });
    const result = await service.getDownloadable(OWNERSHIP_ID, CUSTOMER, tx);
    expect(result.fileId).toBe('f-v2');
  });

  it('rollback 후: currentFileVersion=v1 → v1.fileId 반환 (옛 fileId 그대로 살아 있어야 함)', async () => {
    const service = makeService();
    // rollback 은 currentFileVersionId 만 되돌릴 뿐 v2 row 를 삭제하지 않음.
    // 그래서 versions 배열에는 여전히 V1, V2 둘 다 존재한다.
    const { tx } = makeFakeTx({
      ownership: {
        id: OWNERSHIP_ID,
        customerId: CUSTOMER,
        exercisedAt: new Date(),
        revokedAt: null,
      },
      asset: { id: ASSET_ID, name: 'x', mimeType: null, currentFileVersionId: V1.id },
      versions: [V1, V2],
    });
    const result = await service.getDownloadable(OWNERSHIP_ID, CUSTOMER, tx);
    expect(result.fileId).toBe('f-v1');
  });

  it('revoke 된 ownership 은 ForbiddenError', async () => {
    const service = makeService();
    const { tx } = makeFakeTx({
      ownership: {
        id: OWNERSHIP_ID,
        customerId: CUSTOMER,
        exercisedAt: new Date(),
        revokedAt: new Date(),
      },
      asset: { id: ASSET_ID, name: 'x', mimeType: null, currentFileVersionId: V1.id },
      versions: [V1],
    });
    await expect(service.getDownloadable(OWNERSHIP_ID, CUSTOMER, tx)).rejects.toThrow(
      /has been revoked/,
    );
  });
});

/**
 * 이슈 #353: storefront read API (`listForCustomer`) 는 revoke 된 ownership 을
 * 절대 노출하면 안 된다. fake tx 가 SQL 평가는 못 하므로 captured WHERE 절을 실제
 * SQL 로 풀어서 `revoked_at is null` predicate 가 들어있는지 검증한다.
 */
describe('OwnershipService.listForCustomer — revokedAt IS NULL 필터 (이슈 #353)', () => {
  function makeFakeTxCapturingWhere() {
    const captured: { count?: any; list?: any } = {};
    const tx: any = {
      select: (_cols?: any) => ({
        from: (_t: any) => ({
          // count() select chain
          where: (whereExpr: any) => {
            captured.count = whereExpr;
            return [{ value: 0 }];
          },
          // list select chain
          innerJoin: () => ({
            where: (whereExpr: any) => ({
              orderBy: () => ({
                limit: () => ({
                  offset: () => [],
                }),
              }),
              _captured: (captured.list = whereExpr),
            }),
          }),
        }),
      }),
    };
    return { tx, captured };
  }

  function makeService(): OwnershipService {
    const fakeDb: any = { db: {} };
    return new OwnershipService(fakeDb);
  }

  it("필터 'all' — WHERE 가 customer 일치 AND revoked_at IS NULL 을 포함", async () => {
    const service = makeService();
    const { tx, captured } = makeFakeTxCapturingWhere();

    await service.listForCustomer('c-1', { filter: 'all' }, tx);

    const dialect = new PgDialect();
    for (const w of [captured.count, captured.list]) {
      expect(w).toBeDefined();
      const sql = dialect.sqlToQuery(w).sql.replace(/\s+/g, ' ');
      expect(sql).toMatch(/"customer_id"\s*=\s*\$\d+/);
      expect(sql).toMatch(/"revoked_at"\s+is\s+null/i);
    }
  });

  it("필터 'new' — revoked_at IS NULL 과 exercised_at IS NULL 이 모두 포함", async () => {
    const service = makeService();
    const { tx, captured } = makeFakeTxCapturingWhere();

    await service.listForCustomer('c-1', { filter: 'new' }, tx);

    const sql = new PgDialect().sqlToQuery(captured.list).sql.replace(/\s+/g, ' ');
    expect(sql).toMatch(/"revoked_at"\s+is\s+null/i);
    expect(sql).toMatch(/"exercised_at"\s+is\s+null/i);
  });

  it("필터 'used' — revoked_at IS NULL 과 exercised_at IS NOT NULL 이 모두 포함", async () => {
    const service = makeService();
    const { tx, captured } = makeFakeTxCapturingWhere();

    await service.listForCustomer('c-1', { filter: 'used' }, tx);

    const sql = new PgDialect().sqlToQuery(captured.list).sql.replace(/\s+/g, ' ');
    expect(sql).toMatch(/"revoked_at"\s+is\s+null/i);
    expect(sql).toMatch(/"exercised_at"\s+is\s+not\s+null/i);
  });
});

/**
 * 어드민 ownership API: 조회 필터 / 강제 회수 / 재발급.
 */
describe('OwnershipService — 어드민 (#457)', () => {
  function makeService(): OwnershipService {
    const fakeDb: any = { db: {} };
    return new OwnershipService(fakeDb);
  }

  describe('listForAdmin — status 필터', () => {
    function makeFakeTxCapturingWhere() {
      const captured: { count?: any; list?: any } = {};
      const tx: any = {
        select: () => ({
          from: () => ({
            where: (whereExpr: any) => {
              captured.count = whereExpr;
              return [{ value: 0 }];
            },
            innerJoin: () => ({
              where: (whereExpr: any) => {
                captured.list = whereExpr;
                return {
                  orderBy: () => ({ limit: () => ({ offset: () => [] }) }),
                };
              },
            }),
          }),
        }),
      };
      return { tx, captured };
    }

    it("status 'all' + 필터 없음 — WHERE 는 비어 revoke 포함 전체 조회", async () => {
      const service = makeService();
      const { tx, captured } = makeFakeTxCapturingWhere();

      const res = await service.listForAdmin({ status: 'all' }, tx);

      expect(captured.list).toBeUndefined();
      expect(res.total).toBe(0);
    });

    it("status 'revoked' + customerId — revoked_at IS NOT NULL 과 customer 일치 포함", async () => {
      const service = makeService();
      const { tx, captured } = makeFakeTxCapturingWhere();

      await service.listForAdmin({ customerId: 'c-1', status: 'revoked' }, tx);

      const sql = new PgDialect().sqlToQuery(captured.list).sql.replace(/\s+/g, ' ');
      expect(sql).toMatch(/"customer_id"\s*=\s*\$\d+/);
      expect(sql).toMatch(/"revoked_at"\s+is\s+not\s+null/i);
    });

    it("status 'active' — revoked_at IS NULL 포함", async () => {
      const service = makeService();
      const { tx, captured } = makeFakeTxCapturingWhere();

      await service.listForAdmin({ assetId: 'a-1', status: 'active' }, tx);

      const sql = new PgDialect().sqlToQuery(captured.list).sql.replace(/\s+/g, ' ');
      expect(sql).toMatch(/"asset_id"\s*=\s*\$\d+/);
      expect(sql).toMatch(/"revoked_at"\s+is\s+null/i);
    });
  });

  describe('adminRevoke / adminResend', () => {
    function makeFakeTxForUpdate(opts: { updatedRows: { id: string }[] }) {
      const captured: { set?: any } = {};
      const tx: any = {
        update: () => ({
          set: (val: any) => {
            captured.set = val;
            return {
              where: () => ({ returning: () => opts.updatedRows }),
            };
          },
        }),
        // _loadAdminDto 의 재조회
        select: () => ({
          from: () => ({
            innerJoin: () => ({
              where: () => [
                {
                  ownership: {
                    id: 'o-1',
                    customerId: 'c-1',
                    assetId: 'a-1',
                    salesOrderId: 'so-1',
                    grantedAt: new Date(),
                    exercisedAt: null,
                    revokedAt: captured.set?.revokedAt ?? null,
                    revokedReason: captured.set?.revokedReason ?? null,
                  },
                  asset: { id: 'a-1', name: 'x', description: null, mimeType: null, thumbnailUrl: null },
                },
              ],
            }),
          }),
        }),
      };
      return { tx, captured };
    }

    it('adminRevoke — revokedAt/이유를 채워 회수', async () => {
      const service = makeService();
      const { tx, captured } = makeFakeTxForUpdate({ updatedRows: [{ id: 'o-1' }] });

      const res = await service.adminRevoke('o-1', '운영 회수', tx);

      expect(captured.set.revokedAt).toBeInstanceOf(Date);
      expect(captured.set.revokedReason).toBe('운영 회수');
      expect(res.revokedReason).toBe('운영 회수');
    });

    it('adminRevoke — 대상 없으면 NotFoundError', async () => {
      const service = makeService();
      const { tx } = makeFakeTxForUpdate({ updatedRows: [] });

      await expect(service.adminRevoke('o-x', null, tx)).rejects.toThrow(/not found/i);
    });

    it('adminResend — revokedAt 을 비워 재활성화', async () => {
      const service = makeService();
      const { tx, captured } = makeFakeTxForUpdate({ updatedRows: [{ id: 'o-1' }] });

      const res = await service.adminResend('o-1', tx);

      expect(captured.set.revokedAt).toBeNull();
      expect(captured.set.revokedReason).toBeNull();
      expect(res.revokedAt).toBeNull();
    });
  });
});
