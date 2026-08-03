import { BulkSessionCleaner } from './bulk-session.cleaner';
import { rowMatchesCondition } from './__support__/drizzle-row-matcher';

interface SessionRow {
  id: string;
  phase: string;
  sourceFileId: string | null;
  uploadedBy: string;
  updatedAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** 모든 테스트가 `sweepOnce`/`sweep` 에 넘기는 고정 시각과 맞춘 기준점. */
const BASE_NOW = new Date('2026-08-03T00:00:00Z');

function daysAgo(n: number): Date {
  return new Date(BASE_NOW.getTime() - n * DAY_MS);
}

/**
 * 리뷰 발견 1 픽스 — 예전 버전은 대상 판정 SQL(`inArray(phase,…)` · `isNotNull(sourceFileId)` ·
 * `lt(updatedAt, cutoff)`)을 페이크가 받지 않고 테스트 파일 자체가 같은 술어를 손으로 다시 적어
 * (`TERMINAL_PHASES.includes(...) && ...`) 판정했다. 그 결과 `lt`↔`gt` 전환이나 `inArray` 절
 * 삭제 같은 프로덕션 회귀에도 목이 초록이었다 — 술어 사본이 프로덕션과 별개로 "항상 맞게"
 * 재구현돼 있었을 뿐, 실제 조건을 한 번도 검사하지 않았기 때문이다.
 *
 * 지금은 `bulk-session.manager.spec.ts` 의 `writeSelectChain` 하네스가 쓰는 것과 **같은**
 * `rowMatchesCondition`(`__support__/drizzle-row-matcher.ts`)을 가져다 쓴다 —
 * `PgDialect.sqlToQuery` 로 실제 조건 트리를 렌더해 정규식으로 판정하는 도구다. 이 태스크가
 * 그 렌더러에 `lt` 지원을 새로 추가했다(헬퍼 파일 주석 참조). 테스트 쪽에 술어 사본을 다시
 * 두지 않는 것이 핵심 — 프로덕션의 `.where(condition)` 인자가 그대로 페이크에 전달되어
 * 판정된다.
 */
function harness(rows: SessionRow[], env: Record<string, string> = {}) {
  const sessionRows = rows.map((row) => ({ ...row }));

  const softDelete = jest.fn(() => Promise.resolve(undefined));

  const trx = {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => ({
          orderBy: () => ({
            limit: (n: number) =>
              Promise.resolve(
                sessionRows
                  .filter((row) => rowMatchesCondition(row, condition))
                  .slice(0, n)
                  .map((row) => ({ id: row.id, sourceFileId: row.sourceFileId, uploadedBy: row.uploadedBy })),
              ),
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: Partial<SessionRow>) => ({
        where: (condition: unknown) => {
          const row = sessionRows.find((r) => rowMatchesCondition(r, condition));
          if (row) Object.assign(row, values);
          return Promise.resolve([]);
        },
      }),
    }),
  };

  const db = { run: (fn: (t: unknown) => unknown) => fn(trx) };
  const fileClient = { softDelete };
  const config = { get: (key: string) => env[key] };
  const cleaner = new BulkSessionCleaner(db as never, fileClient as never, config as never);

  return { cleaner, softDelete, sessionRows };
}

describe('BulkSessionCleaner', () => {
  it('종단 세션의 30일 지난 워크북을 지우고 fileId 를 비운다', async () => {
    const { cleaner, softDelete, sessionRows } = harness([
      { id: 'S1', phase: 'published', sourceFileId: 'F1', uploadedBy: 'U1', updatedAt: daysAgo(31) },
    ]);
    const result = await cleaner.sweepOnce(new Date('2026-08-03T00:00:00Z'));
    expect(softDelete).toHaveBeenCalledWith('F1', 'U1');
    expect(sessionRows[0].sourceFileId).toBeNull();
    expect(result).toEqual({ deleted: 1, failed: 0 });
  });

  it('진행 중인 세션은 건드리지 않는다', async () => {
    const { cleaner, softDelete } = harness([
      { id: 'S1', phase: 'drafted', sourceFileId: 'F1', uploadedBy: 'U1', updatedAt: daysAgo(90) },
    ]);
    await cleaner.sweepOnce(new Date('2026-08-03T00:00:00Z'));
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('30일이 안 된 세션은 건드리지 않는다', async () => {
    const { cleaner, softDelete } = harness([
      { id: 'S1', phase: 'canceled', sourceFileId: 'F1', uploadedBy: 'U1', updatedAt: daysAgo(29) },
    ]);
    await cleaner.sweepOnce(new Date('2026-08-03T00:00:00Z'));
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('삭제 실패는 fileId 를 남긴다 — 다음 틱이 다시 시도한다', async () => {
    const { cleaner, softDelete, sessionRows } = harness([
      { id: 'S1', phase: 'canceled', sourceFileId: 'F1', uploadedBy: 'U1', updatedAt: daysAgo(31) },
    ]);
    softDelete.mockRejectedValueOnce(new Error('403'));
    const result = await cleaner.sweepOnce(new Date('2026-08-03T00:00:00Z'));
    expect(sessionRows[0].sourceFileId).toBe('F1');
    expect(result).toEqual({ deleted: 0, failed: 1 });
  });

  // 대상 술어의 세 번째 다리(sourceFileId IS NOT NULL)를 잠근다 — 앞서 스윕이 이미 지운
  // 세션(스키마 주석의 "그것이 스윕의 멱등성이다")은 phase·나이 조건을 만족해도 다시
  // softDelete 를 부르면 안 된다.
  it('이미 워크북이 지워진(sourceFileId=NULL) 세션은 다시 건드리지 않는다', async () => {
    const { cleaner, softDelete } = harness([
      { id: 'S1', phase: 'published', sourceFileId: null, uploadedBy: 'U1', updatedAt: daysAgo(31) },
    ]);
    await cleaner.sweepOnce(new Date('2026-08-03T00:00:00Z'));
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('킬스위치가 꺼져 있으면 크론이 아무것도 하지 않는다', async () => {
    const { cleaner, softDelete } = harness([], { PRODUCT_BULK_SESSION_WORKER_ENABLED: 'false' });
    await cleaner.sweep();
    expect(softDelete).not.toHaveBeenCalled();
  });
});
