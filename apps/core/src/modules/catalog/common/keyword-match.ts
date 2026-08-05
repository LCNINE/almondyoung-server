import { and, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * 검색어를 공백으로 쪼개 토큰마다 AND, 컬럼마다 OR 로 묶는다.
 * 비교 전 양쪽에서 공백을 지우므로 "루비 셀" 로 "루비셀" 이, "루비셀 앰플" 로
 * "루비셀 프리미엄 앰플" 이 잡힌다.
 */
export function keywordMatch(keyword: string, columns: AnyColumn[]): SQL | undefined {
  const tokens = keyword.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || columns.length === 0) return undefined;

  return and(
    ...tokens.map((token) => {
      const pattern = `%${token.replace(/[\\%_]/g, '\\$&')}%`;
      return or(
        ...columns.map(
          (column) => sql`regexp_replace(${column}, '[[:space:]]', '', 'g') ILIKE ${pattern}`,
        ),
      );
    }),
  );
}
