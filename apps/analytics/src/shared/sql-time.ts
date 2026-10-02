import { sql, type SQL, type AnyColumn } from 'drizzle-orm';
import { SEOUL_TZ } from './date.util';

/**
 * `timestamp`(무 시간대) 컬럼을 KST 벽시계로 바꾸는 SQL 식.
 *
 * 이 앱의 timestamp 저장값은 UTC 벽시계다 — drizzle 이 `Date` 를 `toISOString()` 으로 쓴다.
 * 그래서 먼저 `AT TIME ZONE 'UTC'` 로 «UTC 의 그 시각»이라는 순간(timestamptz)을 만들고,
 * 그 순간을 `AT TIME ZONE 'Asia/Seoul'` 로 KST 벽시계로 옮긴다. 결과는 세션 시간대와 무관하다.
 * `col AT TIME ZONE 'Asia/Seoul'` 한 번만 쓰면 저장값을 KST 로 «해석»해 버려 9~18시간 이르게 찍힌다.
 */
export function kstWallClock(column: AnyColumn | SQL): SQL {
  return sql`((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${SEOUL_TZ})`;
}
