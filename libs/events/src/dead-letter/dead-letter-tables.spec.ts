import type { DatabaseRun, DbService } from '@app/db';
import { singleDatabase } from '@app/db/testing/single-database';
import { checkDeadLetterTables } from './dead-letter-tables';

/** 테넌트 DB 마다 `present` 답(또는 실패)을 준다. 부팅 확인은 요청 밖이라 DB 마다 그 맥락에서 물어야 한다. */
function tenantDbs(byKey: Record<string, boolean | Error>): DbService {
  let current = '';
  return {
    get db() {
      const answer = byKey[current];
      return {
        execute: () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve([{ present: answer }])),
      };
    },
    forEachDatabase: async <R>(fn: (key: string) => Promise<R>): Promise<DatabaseRun<R>[]> => {
      const runs: DatabaseRun<R>[] = [];
      for (const key of Object.keys(byKey)) {
        current = key;
        try {
          runs.push({ key, ok: true, value: await fn(key) });
        } catch (error) {
          runs.push({ key, ok: false, error });
        }
      }
      return runs;
    },
  } as unknown as DbService;
}

describe('checkDeadLetterTables', () => {
  it('단일 DB 에 두 테이블이 있으면 있다', async () => {
    const db = singleDatabase({ db: { execute: () => Promise.resolve([{ present: true }]) } }) as unknown as DbService;
    expect(await checkDeadLetterTables(db)).toEqual({ present: true });
  });

  it('테넌트 DB 가 모두 가졌을 때만 있다 — 하나라도 없으면 그 테넌트의 보류 검사가 매 메시지 던진다', async () => {
    expect(await checkDeadLetterTables(tenantDbs({ '1': true, '2': true }))).toEqual({ present: true });
    expect(await checkDeadLetterTables(tenantDbs({ '1': true, '2': false }))).toEqual({ present: false });
  });

  it('한 테넌트 DB 의 질의가 실패하면 없다로 보고, 어느 DB 인지 말한다', async () => {
    const result = await checkDeadLetterTables(tenantDbs({ '1': true, '2': new Error('db down') }));
    expect(result.present).toBe(false);
    expect(result.queryError).toContain('[db=2]');
    expect(result.queryError).toContain('db down');
  });
});
