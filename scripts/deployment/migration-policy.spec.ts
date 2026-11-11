import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { assertAdditiveMigrations, pendingMigrations } from './migration-policy';

const liveCore = { stage: 'live', deployment: 'lcnine-services', service: 'core' };
const skuRename = readMigrationFiles({ migrationsFolder: resolve(__dirname, '../../apps/core/drizzle') }).find(
  (migration) => migration.folderMillis === 1794376282138,
)!;

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

  it('allows the reviewed SKU display-name conversion from the real journal in live Core', () => {
    expect(skuRename).toBeDefined();
    expect(() => assertAdditiveMigrations([skuRename], liveCore)).not.toThrow();
  });

  it.each([
    undefined,
    { ...liveCore, stage: 'dev' },
    { ...liveCore, stage: 'demo' },
    { ...liveCore, deployment: 'lcnine-auth' },
    { ...liveCore, service: 'user-service' },
  ])('does not extend the review to another execution context: %j', (context) => {
    expect(() => assertAdditiveMigrations([skuRename], context)).toThrow('maintenance review');
  });

  it('does not approve a changed SQL file or journal timestamp', () => {
    const changedSql = `${skuRename.sql.join('--> statement-breakpoint')}\nDELETE FROM skus;`;
    const changed = {
      ...skuRename,
      sql: changedSql.split('--> statement-breakpoint'),
      hash: createHash('sha256').update(changedSql).digest('hex'),
    };

    expect(() => assertAdditiveMigrations([changed], liveCore)).toThrow('maintenance review');
    expect(() => assertAdditiveMigrations([{ ...skuRename, folderMillis: 1794376282139 }], liveCore)).toThrow(
      'maintenance review',
    );
  });

  it('still reviews every other pending migration after the approved file', () => {
    expect(() => assertAdditiveMigrations([skuRename, file(1794376282139, 'DELETE FROM skus;')], liveCore)).toThrow(
      '1794376282139',
    );
  });

  it.each([
    'DROP TABLE orders;',
    'TRUNCATE orders;',
    'DELETE FROM orders;',
    "UPDATE orders SET note = 'changed';",
    'ALTER TABLE orders RENAME COLUMN x TO y;',
    'ALTER TABLE orders ALTER COLUMN x TYPE integer;',
    'ALTER TABLE orders ALTER COLUMN x SET NOT NULL;',
    'ALTER TABLE orders ADD COLUMN x text NOT NULL;',
    'DO $$ BEGIN EXECUTE something; END $$;',
  ])('blocks a contract or data operation: %s', (sql) => {
    expect(() => assertAdditiveMigrations([file(1, sql)])).toThrow('maintenance review');
  });
});
