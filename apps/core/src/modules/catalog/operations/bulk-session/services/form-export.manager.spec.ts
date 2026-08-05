import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { FormExportManager, FORM_EXPORT_TTL_DAYS } from './form-export.manager';
import { ConflictError, NotFoundError } from '@app/shared';
import { productFormExports } from '../../../schema/catalog.schema';

type FakeRow = Record<string, unknown>;

/**
 * drizzle 셀렉트 빌더는 thenable 이면서 `.limit()` 도 체이닝된다 — product-import.manager.spec.ts
 * 의 chain() 과 같은 기법이지만, 여기서는 `any` 없이 명시 타입으로 만든다.
 */
interface ChainResult extends Promise<FakeRow[]> {
  limit(): Promise<FakeRow[]>;
}

function chain(rows: FakeRow[]): ChainResult {
  // Promise 인스턴스에 `.limit` 을 얹어 thenable+체이너블 양쪽을 만족시킨다 — 이 형태
  // 자체가 실제 drizzle 빌더 타입과 구조적으로 다르므로 캐스팅이 불가피하다.
  const builder = Promise.resolve(rows) as ChainResult;
  builder.limit = () => Promise.resolve(rows);
  return builder;
}

/** FormExportManager 가 실제로 호출하는 메서드만 흉내낸 최소 trx 모양. */
interface FakeTrx {
  insert: () => { values: (v: FakeRow) => { returning: () => Promise<FakeRow[]> } };
  select: () => { from: () => { where: () => ChainResult } };
  delete: () => { where: () => { returning: () => Promise<FakeRow[]> } };
}

interface FakeDb {
  run: <T>(fn: (trx: FakeTrx) => Promise<T>) => Promise<T>;
}

/**
 * 이 모듈 전용 db 페이크. `product-import.manager.spec.ts` 의 harness() 와 같은 모양
 * (`run(fn)` 이 콜백에 스텁 trx 를 넘기고 insert/select/delete 체인이 미리 정한 값을
 * 돌려준다) 이지만, 저장소 전체에 공용 `fakeDb` 헬퍼는 없어 이 파일 전용으로 새로 쓴다.
 */
function harness(
  opts: {
    exportRow?: FakeRow | null;
    onInsert?: (values: FakeRow) => void;
    purgeRows?: FakeRow[];
    softDeleteImpl?: (fileId: string, userId: string) => Promise<void>;
  } = {},
) {
  const trx: FakeTrx = {
    insert: () => ({
      values: (v) => {
        opts.onInsert?.(v);
        return { returning: () => Promise.resolve([{ id: 'export-1', ...v }]) };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => chain(opts.exportRow ? [opts.exportRow] : []),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve(opts.purgeRows ?? []),
      }),
    }),
  };
  const db: FakeDb = { run: (fn) => fn(trx) };
  const fileClient = {
    getDownloadUrl: jest.fn(() => Promise.resolve('https://file-service.example/signed')),
    softDelete: opts.softDeleteImpl ? jest.fn(opts.softDeleteImpl) : jest.fn(() => Promise.resolve(undefined)),
  };

  // Manager 생성자는 실제 DbService<PimSchema>/FormExportFileClient 타입을 요구한다 — 이
  // 페이크는 Manager 가 실제로 부르는 메서드(run/getDownloadUrl/softDelete)만 구조적으로
  // 흉내내므로 완전한 구조 일치가 아니다. product-import.manager.spec.ts harness 와 같은
  // 관례로 `as never` 캐스팅한다(`as any` 대신 — no-explicit-any 는 꺼져 있지만 그래도 더 좁다).
  const manager = new FormExportManager(db as never, fileClient as never);
  return { manager, trx, fileClient };
}

describe('FormExportManager.accept', () => {
  it('중복 masterId 를 제거하고 요청 수를 돌려준다', async () => {
    const inserted: FakeRow[] = [];
    const { manager } = harness({ onInsert: (v) => inserted.push(v) });

    const out = await manager.accept(['m1', 'm1', 'm2'], 'u1');

    expect(out.requestedCount).toBe(2);
    expect(out.status).toBe('queued');
    expect(inserted[0]?.requestedMasterIds).toEqual(['m1', 'm2']);
  });

  it('만료시각을 30일 뒤로 잡는다', async () => {
    let captured: { expiresAt: Date } | null = null;
    const { manager } = harness({ onInsert: (v) => (captured = v as { expiresAt: Date }) });

    await manager.accept(['m1'], 'u1');

    const days = (captured!.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(FORM_EXPORT_TTL_DAYS);
  });
});

describe('FormExportManager.accept 중복 제거', () => {
  function acceptHarness(inFlight: Record<string, unknown>[]) {
    const inserted: Record<string, unknown>[] = [];
    const trx = {
      select: () => ({ from: () => ({ where: () => Promise.resolve(inFlight) }) }),
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          returning: () => {
            inserted.push(v);
            return Promise.resolve([{ id: 'NEW', ...v }]);
          },
        }),
      }),
    };
    const manager = new FormExportManager(
      { run: async (fn: (t: unknown) => Promise<unknown>) => fn(trx) } as never,
      {} as never,
    );
    return { manager, inserted };
  }

  it('같은 집합의 진행 중 잡이 있으면 그것을 돌려주고 새로 만들지 않는다', async () => {
    const { manager, inserted } = acceptHarness([
      { id: 'E1', status: 'running', requestedMasterIds: ['m1', 'm2'] },
    ]);

    const result = await manager.accept(['m1', 'm2'], 'U1');

    expect(result).toEqual({ exportId: 'E1', status: 'running', requestedCount: 2, reused: true });
    expect(inserted).toHaveLength(0);
  });

  it('순서만 다른 같은 집합도 재사용한다', async () => {
    const { manager, inserted } = acceptHarness([
      { id: 'E1', status: 'queued', requestedMasterIds: ['m2', 'm1'] },
    ]);

    const result = await manager.accept(['m1', 'm2'], 'U1');

    expect(result.exportId).toBe('E1');
    expect(result.reused).toBe(true);
    expect(inserted).toHaveLength(0);
  });

  it('중복된 masterId 를 제거한 뒤 비교한다', async () => {
    const { manager } = acceptHarness([
      { id: 'E1', status: 'running', requestedMasterIds: ['m1', 'm2'] },
    ]);

    const result = await manager.accept(['m1', 'm2', 'm2'], 'U1');

    expect(result.reused).toBe(true);
    expect(result.requestedCount).toBe(2);
  });

  it('집합이 다르면 새 잡을 만든다', async () => {
    const { manager, inserted } = acceptHarness([
      { id: 'E1', status: 'running', requestedMasterIds: ['m1'] },
    ]);

    const result = await manager.accept(['m1', 'm2'], 'U1');

    expect(result.exportId).toBe('NEW');
    expect(result.reused).toBe(false);
    expect(inserted).toHaveLength(1);
  });

  it('진행 중 잡이 없으면 새 잡을 만든다', async () => {
    const { manager, inserted } = acceptHarness([]);

    const result = await manager.accept(['m1'], 'U1');

    expect(result).toEqual({ exportId: 'NEW', status: 'queued', requestedCount: 1, reused: false });
    expect(inserted).toHaveLength(1);
  });
});

describe('FormExportManager.getStatus', () => {
  it('없는 exportId 조회는 NotFoundError 다', async () => {
    const { manager } = harness({ exportRow: null });
    await expect(manager.getStatus('nope', 'u1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('완료가 아니면 downloadable 이 false 다', async () => {
    const { manager } = harness({
      exportRow: {
        id: 'e1',
        status: 'running',
        productCount: 0,
        errorMessage: null,
        fileId: null,
        requestedBy: 'u1',
        expiresAt: new Date(),
      },
    });
    await expect(manager.getStatus('e1', 'u1')).resolves.toMatchObject({ downloadable: false });
  });

  it('완료이고 fileId 가 있으면 downloadable 이 true 다', async () => {
    const { manager } = harness({
      exportRow: {
        id: 'e1',
        status: 'completed',
        productCount: 3,
        errorMessage: null,
        fileId: 'f1',
        requestedBy: 'u1',
        expiresAt: new Date(),
      },
    });
    await expect(manager.getStatus('e1', 'u1')).resolves.toMatchObject({ downloadable: true, productCount: 3 });
  });

  // 남의 export id 는 존재하지 않는 것과 같은 에러여야 한다 — ConflictError 등 다른 상태로
  // 새면 "있는데 내 것이 아님"이 노출되는 오라클이 된다(form-export.manager.ts 주석 참조).
  it('본인 소유가 아닌 export 조회는 NotFoundError 다', async () => {
    const { manager } = harness({
      exportRow: {
        id: 'e1',
        status: 'completed',
        productCount: 3,
        errorMessage: null,
        fileId: 'f1',
        requestedBy: 'owner-1',
        expiresAt: new Date(),
      },
    });
    await expect(manager.getStatus('e1', 'stranger')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('FormExportManager.getDownloadUrl', () => {
  // 이 둘은 서로 다른 상황이라 다른 에러 타입이어야 한다 — 행 자체가 없는 건 잘못된 id(404
  // 취급), 있는데 아직 안 끝난 건 나중에 다시 물어보면 되는 재시도 대상(409 취급)이다.
  // instanceof 를 각각 다른 클래스로 못박아서, 두 분기가 다시 하나로 합쳐지는 회귀를 잡는다.
  it('없는 exportId 조회는 NotFoundError 다 (ConflictError 가 아니다)', async () => {
    const { manager } = harness({ exportRow: null });
    await expect(manager.getDownloadUrl('nope', 'u1')).rejects.toBeInstanceOf(NotFoundError);
    await expect(manager.getDownloadUrl('nope', 'u1')).rejects.not.toBeInstanceOf(ConflictError);
  });

  it('있지만 완료가 아니면 ConflictError 다 (NotFoundError 가 아니다)', async () => {
    const { manager } = harness({ exportRow: { id: 'e1', status: 'running', fileId: null, requestedBy: 'u1' } });
    await expect(manager.getDownloadUrl('e1', 'u1')).rejects.toBeInstanceOf(ConflictError);
    await expect(manager.getDownloadUrl('e1', 'u1')).rejects.not.toBeInstanceOf(NotFoundError);
  });

  it('완료 상태이지만 fileId 가 없으면(비정상 데이터) ConflictError 다', async () => {
    const { manager } = harness({ exportRow: { id: 'e1', status: 'completed', fileId: null, requestedBy: 'u1' } });
    await expect(manager.getDownloadUrl('e1', 'u1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('완료면 fileClient 에 fileId·userId 를 넘기고 결과 URL 을 돌려준다', async () => {
    const { manager, fileClient } = harness({
      exportRow: { id: 'e1', status: 'completed', fileId: 'f1', requestedBy: 'u1' },
    });
    const url = await manager.getDownloadUrl('e1', 'u1');
    expect(url).toBe('https://file-service.example/signed');
    expect(fileClient.getDownloadUrl).toHaveBeenCalledWith('f1', 'u1');
  });

  // 남의 완료된 export 도 (409 가 아니라) NotFoundError 여야 한다 — 상태 검사보다 소유권
  // 검사가 먼저 실행돼야, 남의 진행 중인 export 는 409·완료된 export 는 실제 다운로드 시도로
  // 갈리며 "존재하지만 내 것이 아님"을 간접 노출하는 사고가 안 난다.
  it('본인 소유가 아닌 export 는 완료 상태여도 NotFoundError 고, fileClient 를 부르지 않는다', async () => {
    const { manager, fileClient } = harness({
      exportRow: { id: 'e1', status: 'completed', fileId: 'f1', requestedBy: 'owner-1' },
    });
    await expect(manager.getDownloadUrl('e1', 'stranger')).rejects.toBeInstanceOf(NotFoundError);
    expect(fileClient.getDownloadUrl).not.toHaveBeenCalled();
  });
});

describe('FormExportManager.purgeExpired', () => {
  afterEach(() => jest.restoreAllMocks());

  it('행마다 fileId 가 있으면 fileClient.softDelete 를 호출하고, 없으면 건너뛴다', async () => {
    const { manager, fileClient } = harness({
      purgeRows: [
        { id: 'e1', fileId: 'f1', requestedBy: 'u1' },
        // 아직 조립 전(queued/running/failed)에 만료된 잡은 fileId 가 없다 — 지울 파일이
        // 없으므로 softDelete 를 부르면 안 된다.
        { id: 'e2', fileId: null, requestedBy: 'u2' },
      ],
    });

    const count = await manager.purgeExpired(new Date());

    expect(count).toBe(2);
    expect(fileClient.softDelete).toHaveBeenCalledTimes(1);
    expect(fileClient.softDelete).toHaveBeenCalledWith('f1', 'u1');
  });

  it('파일 삭제가 실패해도 나머지 행 정리를 계속하고, 잡 삭제 건수는 그대로 돌려준다', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { manager, fileClient } = harness({
      purgeRows: [
        { id: 'e1', fileId: 'f1', requestedBy: 'u1' },
        { id: 'e2', fileId: 'f2', requestedBy: 'u2' },
      ],
      softDeleteImpl: (fileId) => {
        if (fileId === 'f1') return Promise.reject(new Error('file-service 삭제 실패 (500)'));
        return Promise.resolve(undefined);
      },
    });

    // 첫 번째 파일 삭제가 실패해도 purgeExpired 자체는 던지지 않는다 — DB 행은 이미
    // 지워졌으므로 파일 정리 실패 때문에 그 결과를 무효화하면 안 된다.
    await expect(manager.purgeExpired(new Date())).resolves.toBe(2);

    // 첫 번째가 실패했다고 두 번째 시도를 건너뛰지 않는다 — 둘 다 시도됐어야 한다.
    expect(fileClient.softDelete).toHaveBeenCalledTimes(2);
    expect(fileClient.softDelete).toHaveBeenNthCalledWith(1, 'f1', 'u1');
    expect(fileClient.softDelete).toHaveBeenNthCalledWith(2, 'f2', 'u2');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('e1'));
  });
});

describe('FormExportManager.list', () => {
  interface ListTrx {
    select: (fields?: unknown) => {
      from: () => {
        where: (condition: unknown) => {
          orderBy: () => { limit: () => { offset: () => Promise<Record<string, unknown>[]> } };
        } & Promise<Record<string, unknown>[]>;
      };
    };
  }

  /**
   * `where()` 에 실제로 넘어온 조건을 캡처한다 — 소유권 필터가 지워지거나 엉뚱한
   * 컬럼으로 바뀌어도 이전 하네스는 계속 초록이었다(리뷰 지적). 행 조회·count 두 질의
   * 모두 같은 조건을 받는지 별도로 기록해, 한쪽만 필터링해 total 이 새는 회귀도 잡는다.
   */
  function listHarness(rows: Record<string, unknown>[], total: number) {
    const calls: { orderBy: number; whereConditions: unknown[] } = { orderBy: 0, whereConditions: [] };
    const page = Promise.resolve(rows);
    const trx: ListTrx = {
      select: (fields?: unknown) => ({
        from: () => {
          // count 질의는 select({ value: count() }) 로 필드를 넘긴다 — 그걸로 갈라낸다.
          const isCount = fields !== undefined;
          return {
            where: (condition: unknown) => {
              calls.whereConditions.push(condition);
              return Object.assign(isCount ? Promise.resolve([{ value: total }]) : page, {
                orderBy: () => {
                  calls.orderBy += 1;
                  return { limit: () => ({ offset: () => page }) };
                },
              });
            },
          };
        },
      }),
    };
    return { trx, calls };
  }

  it('본인 잡만, 최신순으로, 페이지를 잘라 돌려준다', async () => {
    const { trx, calls } = listHarness(
      [
        {
          id: 'E2',
          status: 'completed',
          requestedMasterIds: ['m1', 'm2'],
          productCount: 2,
          errorMessage: null,
          consecutiveFailures: 0,
          fileId: 'F1',
          createdAt: new Date('2026-08-06T00:00:00Z'),
          expiresAt: new Date('2026-09-05T00:00:00Z'),
        },
      ],
      7,
    );
    const manager = new FormExportManager(
      { run: async (fn: (t: unknown) => Promise<unknown>) => fn(trx) } as never,
      {} as never,
    );

    const result = await manager.list('U1', 2, 20);

    expect(result.total).toBe(7);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(20);
    expect(calls.orderBy).toBe(1);
    // 행 조회·count 두 질의 모두 where() 를 받았고, 둘 다 같은 소유권 조건이어야 한다 —
    // 한쪽만 필터링하면 total 이 남의 잡까지 세는 버그가 되는데 흔히 있을 법한 실수다.
    const expectedOwnership = eq(productFormExports.requestedBy, 'U1');
    expect(calls.whereConditions).toHaveLength(2);
    expect(calls.whereConditions[0]).toEqual(expectedOwnership);
    expect(calls.whereConditions[1]).toEqual(expectedOwnership);
    expect(result.data).toEqual([
      {
        exportId: 'E2',
        status: 'completed',
        requestedCount: 2,
        productCount: 2,
        errorMessage: null,
        consecutiveFailures: 0,
        downloadable: true,
        createdAt: '2026-08-06T00:00:00.000Z',
        expiresAt: '2026-09-05T00:00:00.000Z',
      },
    ]);
  });

  it('fileId 가 없으면 completed 여도 downloadable 이 아니다', async () => {
    const { trx } = listHarness(
      [
        {
          id: 'E3',
          status: 'completed',
          requestedMasterIds: ['m1'],
          productCount: 0,
          errorMessage: null,
          consecutiveFailures: 0,
          fileId: null,
          createdAt: new Date('2026-08-06T00:00:00Z'),
          expiresAt: new Date('2026-09-05T00:00:00Z'),
        },
      ],
      1,
    );
    const manager = new FormExportManager(
      { run: async (fn: (t: unknown) => Promise<unknown>) => fn(trx) } as never,
      {} as never,
    );

    const result = await manager.list('U1', 1, 20);

    expect(result.data[0].downloadable).toBe(false);
  });
});
