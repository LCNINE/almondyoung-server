import { assertAdditiveMigrations, pendingMigrations } from './migration-policy';

const file = (time: number, sql = 'ALTER TABLE orders ADD COLUMN note text;') => ({
  folderMillis: time,
  hash: `hash-${time}`,
  bps: true,
  sql: [sql],
});

describe('deployment migration policy', () => {
  it('only selects pending migrations, including an unchanged source deployment', () => {
    expect(pendingMigrations([file(1), file(2)], [{ created_at: 1, hash: 'hash-1' }])).toEqual([file(2)]);
    expect(pendingMigrations([file(1)], [{ created_at: 1, hash: 'hash-1' }])).toEqual([]);
  });

  it.each([
    [{ created_at: 1, hash: 'edited' }],
    [{ created_at: 2, hash: 'hash-2' }],
    [{ created_at: 3, hash: 'hash-3' }],
  ])('blocks edited, missing, or newer migration history: %j', (history) => {
    expect(() => pendingMigrations([file(1), file(2)], [history])).toThrow('history');
  });

  it('rejects unordered journal entries', () => {
    expect(() => pendingMigrations([file(2), file(1)], [])).toThrow('increasing');
  });

  it('allows additive changes and ignores comments', () => {
    expect(() =>
      assertAdditiveMigrations([file(1, '-- DROP TABLE example\nALTER TABLE orders ADD COLUMN note text;')]),
    ).not.toThrow();
  });

  it.each([
    'DROP TABLE orders;',
    'TRUNCATE orders;',
    'DELETE FROM orders;',
    'ALTER TABLE orders RENAME COLUMN x TO y;',
    'ALTER TABLE orders ALTER COLUMN x TYPE integer;',
    'ALTER TABLE orders ALTER COLUMN x SET NOT NULL;',
    'ALTER TABLE orders ADD COLUMN x text NOT NULL;',
    'DO $$ BEGIN EXECUTE something; END $$;',
  ])('blocks a contract or data operation: %s', (sql) => {
    expect(() => assertAdditiveMigrations([file(1, sql)])).toThrow('maintenance review');
  });
});
