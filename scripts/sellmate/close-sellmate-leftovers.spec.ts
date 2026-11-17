import { PgDialect } from 'drizzle-orm/pg-core';
import { bindTextArrayParam } from './close-sellmate-leftovers';

describe('bindTextArrayParam — 기존 스크립트의 $1::text[] 문장을 drizzle 파라미터로', () => {
  const dialect = new PgDialect();

  it('자리마다 배열 파라미터 하나를 묶는다', () => {
    const q = dialect.sqlToQuery(bindTextArrayParam('a=any($1::text[]) and b=any($1::text[])', ['x', 'y']));
    expect(q.params).toEqual([
      ['x', 'y'],
      ['x', 'y'],
    ]);
    expect(q.sql).toBe('a=any($1::text[]) and b=any($2::text[])');
  });

  it('자리가 없는 문장은 거절한다 — 기존 문장이 바뀌었다는 뜻이다', () => {
    expect(() => bindTextArrayParam('update x set y = 1', ['x'])).toThrow(/\$1::text\[\]/);
  });
});
