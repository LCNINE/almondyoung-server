import type { DatabaseRun } from '../db.service';

/**
 * 스펙용. `db` 만 흉내 낸 `DbService` 가짜에 라우터 없는 앱의 `forEachDatabase`(맥락 없이 한 번)를 붙인다.
 * 요청 밖 작업(크론·디스패처·수집기)은 `forEachDatabase` 로 DB 에 닿으므로, 그 작업을 재는 가짜엔 이게 있어야 한다.
 */
export function singleDatabase<T extends object>(
  fake: T,
): T & { forEachDatabase: <R>(fn: (key: undefined) => Promise<R>) => Promise<DatabaseRun<R>[]> } {
  return Object.assign(fake, {
    forEachDatabase: async <R>(fn: (key: undefined) => Promise<R>): Promise<DatabaseRun<R>[]> => {
      try {
        return [{ key: undefined, ok: true, value: await fn(undefined) }];
      } catch (error) {
        return [{ key: undefined, ok: false, error }];
      }
    },
  });
}
