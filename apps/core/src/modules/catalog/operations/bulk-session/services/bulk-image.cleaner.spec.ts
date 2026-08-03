import { BulkImageCleaner, IMAGE_CLEANUP_BATCH } from './bulk-image.cleaner';

/**
 * 이 스펙은 스윕의 **결정과 부수효과**만 본다 — 어떤 행을 고르는지(SQL 술어)는 페이크로
 * 흉내 낼 수 없으므로 통합 스펙(Task 8)이 실 Postgres 로 증명한다. 여기서는 후처리
 * (성공 → fileId 비우기, 실패 → 뒤로 미루기, 업로더 없음 → 건너뛰기)를 못 박는다.
 */
function harness(
  rows: Array<{ id: string; fileId: string | null; uploadedBy: string | null }>,
  failing: string[] = [],
) {
  const updates: Array<{ id: string; values: Record<string, unknown> }> = [];
  const deleted: string[] = [];

  const trx = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({ limit: () => Promise.resolve(rows) }),
          }),
        }),
        // 대상 쿼리의 `where()` 인자는 `notExists(trx.select().from(productBulkItems).where(...))`
        // 서브쿼리를 안에 품는다 — JS 는 `.where()` 를 부르기 전에 그 인자를 먼저
        // 평가하므로, 이 서브쿼리는 innerJoin 을 거치지 않고 `from().where()` 로 바로
        // 이어진다. 반환값은 바깥 `where()`(위 줄)가 인자를 무시하고 버리므로 내용은
        // 의미가 없다 — 여기서 검증하는 건 대상 선택 SQL 이 아니라 후처리다(Task 8 이
        // 실 Postgres 로 술어를 증명한다).
        where: () => ({}),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        // 어느 행인지는 조건 렌더 대신 호출 순서로 짝짓는다 — 이 스펙의 관심사는
        // "성공/실패에 따라 무엇을 쓰는가"이고, 대상 선택(SQL 술어)은 통합 스펙이 본다.
        where: () => {
          updates.push({ id: String(updates.length), values });
          return Promise.resolve([]);
        },
      }),
    }),
  };

  // 스윕은 master 없는 `softDeleteOwnedFile` 만 써야 한다 — 대상 fileId 가 작업자
  // 통보값이라, 워크북용 `softDelete`(master 스코프)로 되돌아가면 남의 상품 이미지를
  // 지우는 프리미티브가 된다. 페이크에 `softDelete` 가 없는 것이 그 회귀를 잡는다.
  const fileClient = {
    softDeleteOwnedFile: (fileId: string) => {
      if (failing.includes(fileId)) return Promise.reject(new Error('boom'));
      deleted.push(fileId);
      return Promise.resolve();
    },
  };

  const db = { run: (fn: (t: unknown) => unknown) => fn(trx) };
  const config = { get: () => undefined };
  const cleaner = new BulkImageCleaner(db as never, fileClient as never, config as never);
  return { cleaner, updates, deleted };
}

describe('BulkImageCleaner.sweepOnce', () => {
  it('대상 파일을 지우고 행의 fileId 를 비운다', async () => {
    const { cleaner, updates, deleted } = harness([{ id: 'r1', fileId: 'f1', uploadedBy: 'u1' }]);
    await expect(cleaner.sweepOnce()).resolves.toEqual({ deleted: 1, failed: 0 });
    expect(deleted).toEqual(['f1']);
    expect(updates[0].values).toMatchObject({ fileId: null, status: 'awaiting_upload' });
  });

  // 실패한 행이 매 틱 배치 앞머리를 차지하면 뒤의 정상 행이 영영 안 지워진다.
  it('실패하면 updatedAt 만 갱신해 대기열 뒤로 보낸다', async () => {
    const { cleaner, updates } = harness([{ id: 'r1', fileId: 'f1', uploadedBy: 'u1' }], ['f1']);
    await expect(cleaner.sweepOnce()).resolves.toEqual({ deleted: 0, failed: 1 });
    expect(updates[0].values).not.toHaveProperty('fileId');
    expect(updates[0].values).toHaveProperty('updatedAt');
  });

  it('업로더가 없으면 위임 토큰을 만들 수 없어 건너뛴다', async () => {
    const { cleaner, deleted } = harness([{ id: 'r1', fileId: 'f1', uploadedBy: null }]);
    await expect(cleaner.sweepOnce()).resolves.toEqual({ deleted: 0, failed: 1 });
    expect(deleted).toEqual([]);
  });

  it('배치 상한이 있다', () => {
    expect(IMAGE_CLEANUP_BATCH).toBeLessThanOrEqual(200);
  });
});
