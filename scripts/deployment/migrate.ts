#!/usr/bin/env tsx
/** CodeBuild predeploy entry point. No bootstrap, seeds, push, reset, or automatic rollback. */
import { resolve } from 'path';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { buildDatabaseUrl } from '../seeding/lib/db-connection';
import { ensureInsideSstShell, parseCommonArgs } from '../seeding/lib/sst-shell-relaunch';
import { resolveRegistry, sstShellStage } from '../seeding/lib/tenant-registry';
import { serviceLabel } from '../seeding/lib/core-tenants';
import { assertAdditiveMigrations, pendingMigrations, AppliedMigration } from './migration-policy';

async function main() {
  const args = parseCommonArgs(process.argv);
  if (
    !['dev', 'demo', 'live'].includes(args.stage ?? '') ||
    !['lcnine-auth', 'lcnine-services'].includes(args.deployment ?? '')
  ) {
    throw new Error('Explicit stage and lcnine-auth/lcnine-services deployment are required');
  }

  await ensureInsideSstShell(args);
  if (sstShellStage(process.env) !== args.stage) throw new Error('SST shell stage does not match the requested stage');
  const app = JSON.parse(process.env.SST_RESOURCE_App ?? '{}');
  if (app.name !== args.deployment) throw new Error('SST shell deployment does not match the requested deployment');
  process.env.SST_STAGE = args.stage;
  // SST relaunches from deployments/lcnine/<unit>; registry paths are repository-relative.
  process.chdir(resolve(__dirname, '../..'));
  const checkOnly = process.argv.includes('--check-only');

  for (const service of resolveRegistry({ deployment: args.deployment })) {
    if (!service.drizzleConfig) continue; // Medusa keeps its existing container-start migration owner.

    const label = serviceLabel(service);
    const config = require(resolve(service.drizzleConfig)).default;
    if (config.dialect !== 'postgresql' || !config.out) throw new Error(`Unsupported migration config: ${label}`);
    const migrationsSchema = config.migrations?.schema ?? 'drizzle';
    const migrationsTable = config.migrations?.table ?? '__drizzle_migrations';
    if (![migrationsSchema, migrationsTable].every((value) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value))) {
      throw new Error(`Invalid migration history identifiers: ${label}`);
    }

    const options = { migrationsFolder: resolve(config.out), migrationsSchema, migrationsTable };
    const files = readMigrationFiles(options);
    const client = new Client({ connectionString: buildDatabaseUrl(service.database), connectionTimeoutMillis: 15000 });
    let locked = false;
    let phase = 'connect';
    try {
      await client.connect();
      if (checkOnly) await client.query('BEGIN READ ONLY');
      phase = 'lock';
      locked = (await client.query('SELECT pg_try_advisory_lock(724357, 1) AS locked')).rows[0].locked;
      if (!locked) throw new Error('Another migration is running');
      await client.query("SET lock_timeout = '15s'");
      await client.query("SET statement_timeout = '10min'");

      phase = 'history';
      const qualified = `"${migrationsSchema}"."${migrationsTable}"`;
      const exists = (await client.query('SELECT to_regclass($1) AS relation', [qualified])).rows[0].relation;
      let applied: AppliedMigration[] = [];
      if (exists) {
        applied = (await client.query(`SELECT hash, created_at FROM ${qualified} ORDER BY created_at`)).rows;
      } else {
        const tables = await client.query(
          "SELECT 1 FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'drizzle') LIMIT 1",
        );
        if (tables.rowCount)
          throw new Error('Existing database has no migration history; baseline reconciliation required');
      }

      const pending = pendingMigrations(files, applied);
      phase = 'sql-review';
      assertAdditiveMigrations(pending);
      console.log(JSON.stringify({ step: 'migration', service: label, pending: pending.length }));
      phase = 'apply';
      if (pending.length && !checkOnly) await migrate(drizzle(client), options);
      console.log(
        JSON.stringify({
          step: 'migration',
          service: label,
          status: checkOnly ? 'validated' : pending.length ? 'applied' : 'up-to-date',
          pending: pending.length,
        }),
      );
    } catch (error) {
      // Driver errors can include SQL, hostnames and connection credentials.
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
      console.error(
        JSON.stringify({
          step: 'migration',
          service: label,
          phase,
          status: 'failed',
          sqlState: code && /^[0-9A-Z]{5}$/.test(code) ? code : undefined,
        }),
      );
      throw new Error(
        `Migration blocked or failed for ${label}; application deployment stopped. Check connectivity, history, and pending SQL with an administrator.`,
      );
    } finally {
      if (checkOnly) await client.query('ROLLBACK').catch(() => undefined);
      if (locked) await client.query('SELECT pg_advisory_unlock(724357, 1)').catch(() => undefined);
      await client.end().catch(() => undefined);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Migration failed');
  process.exitCode = 1;
});
