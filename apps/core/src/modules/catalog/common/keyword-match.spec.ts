import { PgDialect } from 'drizzle-orm/pg-core';
import { productMasterVersions } from '../schema/catalog.schema';
import { keywordMatch } from './keyword-match';

const dialect = new PgDialect();
const build = (keyword: string) => {
  const match = keywordMatch(keyword, [productMasterVersions.name, productMasterVersions.productCode]);
  return match ? dialect.sqlToQuery(match) : undefined;
};

describe('keywordMatch', () => {
  it('토큰마다 AND, 컬럼마다 OR 로 묶는다', () => {
    const query = build('루비셀 앰플')!;

    expect(query.params).toEqual(['%루비셀%', '%루비셀%', '%앰플%', '%앰플%']);
    expect(query.sql.match(/ and /g)).toHaveLength(1);
  });

  it('비교 전 컬럼의 공백을 지운다', () => {
    expect(build('루비 셀')!.sql).toContain(`regexp_replace(`);
    expect(build('루비 셀')!.sql).toContain(`'[[:space:]]', '', 'g'`);
  });

  it('LIKE 와일드카드를 이스케이프한다', () => {
    expect(build('100%_할인')!.params).toEqual(['%100\\%\\_할인%', '%100\\%\\_할인%']);
  });

  it('공백뿐인 검색어는 조건을 만들지 않는다', () => {
    expect(build('   ')).toBeUndefined();
  });
});
