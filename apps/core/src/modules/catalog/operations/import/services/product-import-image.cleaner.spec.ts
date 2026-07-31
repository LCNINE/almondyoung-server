import { PgDialect } from 'drizzle-orm/pg-core';
import { ProductImportImageCleaner } from './product-import-image.cleaner';
import { productImportSessions } from '../../../schema/catalog.schema';

/**
 * drizzle sql 조각을 실제 SQL 문자열 + 바인딩 파라미터로 렌더한다. product-import.manager.spec.ts /
 * product-import-job.manager.spec.ts 의 renderQuery 와 같은 기법 — where 절이 무엇을 걸렀는지는
 * 목이 반환한 행만 봐서는 알 수 없고 condition 자체를 렌더해야 단정할 수 있다.
 */
function renderQuery(query: unknown): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query as never);
}

describe('ProductImportImageCleaner', () => {
  /**
   * cleanupUploaded 는 한 트랜잭션에서 세션 1행 + 이미지 N행을 읽는다.
   * 세션 조회만 `.limit(1)` 로 끝나므로 그 형태로 분기한다.
   */
  function harness(fileIds: Array<string | null>, uploadedBy: string | null = 'u-1') {
    const softDelete = jest.fn().mockResolvedValue(undefined);
    let imagesCondition: unknown;
    const trx = {
      select: (_projection?: unknown) => ({
        from: (table: unknown) => ({
          where: (condition?: unknown) => {
            if (table === productImportSessions) {
              return { limit: () => Promise.resolve([{ uploadedBy }]) };
            }
            imagesCondition = condition;
            return Promise.resolve(fileIds.map((fileId) => ({ fileId })));
          },
        }),
      }),
    };
    const db = { run: <T>(fn: (t: unknown) => Promise<T>) => fn(trx) } as never;
    const cleaner = new ProductImportImageCleaner(db, { softDelete } as never);
    return { cleaner, softDelete, getImagesCondition: () => imagesCondition };
  }

  it('uploaded 행의 fileId 를 전부 지운다', async () => {
    const { cleaner, softDelete } = harness(['f-1', 'f-2']);
    await cleaner.cleanupUploaded('s-1');
    expect(softDelete).toHaveBeenCalledTimes(2);
    expect(softDelete).toHaveBeenCalledWith('f-1', 'u-1');
    expect(softDelete).toHaveBeenCalledWith('f-2', 'u-1');
  });

  it('fileId 가 null 인 행은 건너뛴다', async () => {
    const { cleaner, softDelete } = harness([null, 'f-2']);
    await cleaner.cleanupUploaded('s-1');
    expect(softDelete).toHaveBeenCalledTimes(1);
    expect(softDelete).toHaveBeenCalledWith('f-2', 'u-1');
  });

  it('일부 삭제가 실패해도 나머지를 계속 지우고 던지지 않는다', async () => {
    const { cleaner, softDelete } = harness(['f-1', 'f-2']);
    softDelete.mockRejectedValueOnce(new Error('403'));
    await expect(cleaner.cleanupUploaded('s-1')).resolves.toBeUndefined();
    expect(softDelete).toHaveBeenCalledTimes(2);
  });

  it('지울 것이 없으면 file-service 를 부르지 않는다', async () => {
    const { cleaner, softDelete } = harness([]);
    await cleaner.cleanupUploaded('s-1');
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('uploaded_by 가 없는 옛 세션은 조용히 건너뛴다', async () => {
    const { cleaner, softDelete } = harness(['f-1'], null);
    await expect(cleaner.cleanupUploaded('s-1')).resolves.toBeUndefined();
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('정리 대상 조건은 status 가 아니라 fileId 존재 여부다 — 업로드는 됐는데 상태 기록이 실패한 행도 지워야 한다(§finding4)', async () => {
    const { cleaner, getImagesCondition } = harness(['f-1']);
    await cleaner.cleanupUploaded('s-1');

    const { sql, params } = renderQuery(getImagesCondition());
    // status 컬럼을 전혀 언급하지 않아야 한다 — 언급하는 순간 'uploaded' 로 좁혀
    // fetch_failed 등으로 남은 고아 fileId 를 다시 놓친다.
    expect(sql.toLowerCase()).not.toContain('status');
    expect(params).not.toContain('uploaded');
    expect(sql.toLowerCase()).toContain('is not null');
  });
});
