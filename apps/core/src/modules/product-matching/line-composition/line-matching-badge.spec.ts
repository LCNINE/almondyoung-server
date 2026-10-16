import { PgDialect } from 'drizzle-orm/pg-core';
import { lineMatchingBadgeResolvedSql, lineResolvedSql } from './line-resolved.sql';

describe('lineMatchingBadgeResolvedSql', () => {
  const dialect = new PgDialect();

  it('treats an outsourced line as resolved and leaves the rest to lineResolvedSql', () => {
    const badge = dialect.sqlToQuery(lineMatchingBadgeResolvedSql()).sql;
    const base = dialect.sqlToQuery(lineResolvedSql()).sql;
    expect(badge).toContain('"almond_design_id" IS NOT NULL OR ');
    expect(badge).toContain(base);
  });

  it('does not change lineResolvedSql itself (digital stays judged by the caller)', () => {
    const base = dialect.sqlToQuery(lineResolvedSql()).sql;
    expect(base).not.toContain('almond_design_id');
    expect(base).not.toContain('digital');
  });
});
