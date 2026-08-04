import { PgDialect } from 'drizzle-orm/pg-core';

/**
 * `bulk-session.manager.spec.ts` 의 `writeSelectChain` 하네스와 `bulk-session.cleaner.spec.ts`
 * 가 공유하는 렌더링 기반 drizzle 조건 판정기.
 *
 * 처음에는 `rowMatchesCondition` 이 `bulk-session.manager.spec.ts` 안에만 있었다. Task 7
 * 리뷰에서 `bulk-session.cleaner.spec.ts` 가 이걸 가져다 쓰지 않고 **자기만의 술어 사본**을
 * 손으로 다시 적어(`TERMINAL_PHASES.includes(...) && ...`) `lt`↔`gt` 전환이나 `inArray` 절
 * 삭제 같은 프로덕션 회귀에도 목이 초록인 결함이 나왔다. 처음에는 `bulk-session.cleaner.spec.ts`
 * 가 `bulk-session.manager.spec.ts` 를 직접 import 해서 고쳤는데(`picking-strategy.contract
 * .spec.ts` 를 다른 전략 스펙이 가져다 쓰는 선례를 따름), 그 결과 `bulk-session.cleaner.spec.ts`
 * 를 단독 실행해도 매니저 스펙의 describe/it 61건이 **같이** 등록되어 도는 부작용이 실측으로
 * 드러났다(picking 쪽 contract 파일은 애초에 "여러 전략에 같은 계약을 반복 적용"하려고
 * 설계된 재사용이라 그 중복이 의도된 것이지만, 여긴 순수 유틸 함수 하나를 빌리는 것뿐이라
 * 그 중복이 의도가 아니다). 그래서 `__support__/`(fulfillment 쪽 `logistics-fixtures.ts`,
 * `waybill-fixtures.ts` 와 같은, `*.spec.ts` 로 안 끝나 jest `testRegex` 에 안 걸리는 관례)로
 * 뽑아 양쪽 스펙이 이 파일 하나를 가져다 쓰게 했다.
 */

/** drizzle 조건 판정 대상 행. 컬럼 값은 무엇이든 올 수 있어 `unknown` 인덱스로 둔다. */
export type FakeRow = Record<string, unknown>;

const dialect = new PgDialect();

/** drizzle 컬럼명(snake_case) → 픽스처 키(camelCase). */
function toCamelKey(column: string): string {
  return column.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * `row[key]`/드라이버 파라미터를 비교 가능한 epoch ms 로 정규화한다. 타임스탬프 컬럼은
 * 픽스처 쪽이 실제 `Date`, `PgDialect.sqlToQuery` 가 렌더한 파라미터 쪽은 드라이버 인코딩
 * 문자열(`toISOString()` 형태)이라 표현이 다르다 — 직접 렌더해 확인했다(`typeof param ===
 * 'string'`, `Date` 인스턴스가 아니다). 문자열 사전순 비교(`'2' < '10'` 함정)를 피하려고
 * 반드시 이 함수를 거쳐 숫자로 비교한다. 파싱 불가면 `NaN` 을 돌려주고, 호출부가 `Number
 * .isFinite` 로 걸러 "매치 안 됨"으로 안전하게 처리한다.
 */
function toEpochMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') return new Date(value).getTime();
  return NaN;
}

/**
 * `.where()` 에 넘어온 조건을 렌더해 행 하나가 그 조건을 만족하는지 판정한다. `eq`/`ne`/
 * `isNotNull`/`isNull`/`inArray`/`notInArray`/`lt` 조합만 지원한다 — 이 파일을 가져다 쓰는
 * 스펙들이 실제로 쓰는 연산자가 그것뿐이다(더 복잡한 조건이 생기면 그때 확장한다).
 */
export function rowMatchesCondition(row: FakeRow, condition: unknown): boolean {
  if (condition === undefined) return true;
  const { sql, params } = dialect.sqlToQuery(condition as never);
  const lowered = sql.toLowerCase();
  let ok = true;

  for (const m of lowered.matchAll(/"(\w+)"\s*=\s*\$(\d+)/g)) {
    const key = toCamelKey(m[1]);
    if (row[key] !== params[Number(m[2]) - 1]) ok = false;
  }
  // `ne()` 가 렌더하는 `<>`. `=` 정규식과 문자 집합이 겹치지 않아(`<>` 에는 `=` 가 없다)
  // 서로의 매치를 침범하지 않는다.
  for (const m of lowered.matchAll(/"(\w+)"\s*<>\s*\$(\d+)/g)) {
    const key = toCamelKey(m[1]);
    if (row[key] === params[Number(m[2]) - 1]) ok = false;
  }
  // `lt()` 가 렌더하는 `<`. 아래 두 정규식은 서로의 매치를 침범하지 않는다(직접 렌더해 확인:
  // `lt(col, v)` → `"col" < $1`, `ne(col, v)` → `"col" <> $1`):
  //   - 이 `<` 정규식은 `<` 바로 뒤에 공백(0개 이상) 다음 `$`(파라미터 자리표시자)를 요구한다.
  //     `<>` 문자열은 `<` 바로 뒤가 `>` 라 이 자리에서 매치가 실패해 위 `ne` 케이스를 훔치지
  //     않는다.
  //   - 반대로 위 `<>` 정규식은 리터럴 두 글자 `<>` 를 통째로 요구하므로, `lt()` 가 남기는
  //     `< $N`(사이에 `>` 없음)에는 매치되지 않아 이 케이스를 훔치지 않는다.
  for (const m of lowered.matchAll(/"(\w+)"\s*<\s*\$(\d+)/g)) {
    const key = toCamelKey(m[1]);
    const left = toEpochMs(row[key]);
    const right = toEpochMs(params[Number(m[2]) - 1]);
    if (!(Number.isFinite(left) && Number.isFinite(right) && left < right)) ok = false;
  }
  for (const m of lowered.matchAll(/"(\w+)"\s+is\s+not\s+null/g)) {
    const key = toCamelKey(m[1]);
    if (row[key] === null || row[key] === undefined) ok = false;
  }
  // "is not null" 도 문자열로는 "is ... null" 을 담지만 "not" 이 공백이 아니라서 아래
  // `\s+null` 에 안 걸린다 — 두 정규식이 서로의 매치를 침범하지 않는다.
  for (const m of lowered.matchAll(/"(\w+)"\s+is\s+null/g)) {
    const key = toCamelKey(m[1]);
    if (!(row[key] === null || row[key] === undefined)) ok = false;
  }
  for (const m of lowered.matchAll(/"(\w+)"\s+not\s+in\s+\(([^)]*)\)/g)) {
    const key = toCamelKey(m[1]);
    const excluded = m[2].split(',').map((placeholder) => params[Number(placeholder.trim().replace('$', '')) - 1]);
    if (excluded.includes(row[key])) ok = false;
  }
  // "not in" 은 위에서 이미 소비된다 — 이 정규식은 컬럼명 바로 뒤에 공백만 두고 오는
  // 양의 `in (...)`(`inArray`)만 잡는다. "col not in (...)" 문자열에서는 컬럼과 "in"
  // 사이에 "not "이 끼어 `\s+in\s+\(` 이 매치되지 않으므로 두 루프가 서로 침범하지 않는다
  // (파일 상단 is/is not null 쌍과 같은 관례).
  for (const m of lowered.matchAll(/"(\w+)"\s+in\s+\(([^)]*)\)/g)) {
    const key = toCamelKey(m[1]);
    const included = m[2].split(',').map((placeholder) => params[Number(placeholder.trim().replace('$', '')) - 1]);
    if (!included.includes(row[key])) ok = false;
  }

  return ok;
}
