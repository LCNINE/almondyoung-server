import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';
import type { Sql } from 'postgres';
import {
  CATALOG_TABLES,
  SNAPSHOT_SCHEMA_VERSION,
  assertSnapshot,
  emptyCatalogTables,
  finalizeSnapshot,
  normalizeNullableOrphans,
  type CatalogSnapshot,
  type CatalogTablePolicy,
  type DatabaseIdentity,
  type SnapshotSourceIdentity,
} from './catalog-policy';

interface SourceIdentityProbe extends DatabaseIdentity {
  stage: string;
  readOnly: boolean;
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) throw new Error(`Unsafe SQL identifier: ${identifier}`);
  return `"${identifier}"`;
}

export function buildSnapshotSelect(table: CatalogTablePolicy): string {
  // Bypass the driver's Date conversion: naive timestamps retain their wall time, and both
  // timestamp types retain PostgreSQL microseconds across the JSON snapshot boundary.
  const columns = table.columns
    .map((column) => {
      const name = quoteIdentifier(column.name);
      return column.pgType === 'timestamp' || column.pgType === 'timestamptz' ? `${name}::text AS ${name}` : name;
    })
    .join(', ');
  const orderBy = table.conflictColumns.map(quoteIdentifier).join(', ');
  return `SELECT ${columns} FROM ${quoteIdentifier(table.name)} ORDER BY ${orderBy}`;
}

export function assertLiveSource(
  actual: SourceIdentityProbe,
  expected: DatabaseIdentity,
): asserts actual is SnapshotSourceIdentity {
  if (actual.stage !== 'live') throw new Error(`Source stage must be live; received ${actual.stage}`);
  if (!actual.readOnly) throw new Error('Source transaction must be read-only');
  if (actual.database !== expected.database || actual.host !== expected.host || actual.port !== expected.port) {
    throw new Error(
      `Source binding mismatch (expected ${expected.host}:${expected.port}/${expected.database}, ` +
        `received ${actual.host}:${actual.port}/${actual.database})`,
    );
  }
}

export function snapshotFromRows(
  tables: CatalogSnapshot['tables'],
  source: SnapshotSourceIdentity,
  generatedAt = new Date().toISOString(),
): CatalogSnapshot {
  const normalizations = normalizeNullableOrphans(tables);
  const snapshot: CatalogSnapshot = {
    manifest: {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      generatedAt,
      source,
      skuIds: [],
      skuIdSha256: '',
      counts: {},
      normalizations,
      contentSha256: '',
    },
    tables,
  };
  finalizeSnapshot(snapshot);
  assertSnapshot(snapshot);
  return snapshot;
}

export async function readCatalogSnapshot(
  client: Sql,
  expected: DatabaseIdentity,
  stage: string,
): Promise<CatalogSnapshot> {
  return client.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (transaction) => {
    const tx = transaction as unknown as Sql;
    const [identity] = await tx<
      {
        database: string;
        host: string;
        port: number;
        read_only: boolean;
      }[]
    >`
      SELECT current_database() AS database,
             COALESCE(host(inet_server_addr()), 'local') AS host,
             inet_server_port()::int AS port,
             current_setting('transaction_read_only') = 'on' AS read_only
    `;
    const probe: SourceIdentityProbe = {
      stage,
      database: identity.database,
      host: identity.host,
      port: Number(identity.port),
      readOnly: Boolean(identity.read_only),
    };
    assertLiveSource(probe, expected);
    const source: SnapshotSourceIdentity = probe;

    const tables = emptyCatalogTables();
    for (const table of CATALOG_TABLES) {
      tables[table.name] = (await tx.unsafe(buildSnapshotSelect(table))) as unknown as Record<string, unknown>[];
    }
    return snapshotFromRows(tables, source);
  });
}

interface SnapshotCliOptions {
  out?: string;
  export: boolean;
  sourceStage?: string;
  expectedDatabase?: string;
  expectedHost?: string;
  expectedPort?: number;
}

function parseArgs(argv: string[]): SnapshotCliOptions {
  const options: SnapshotCliOptions = { export: false };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    switch (arg) {
      case '--export':
        options.export = true;
        break;
      case '--out':
        options.out = value;
        index += 1;
        break;
      case '--source-stage':
        options.sourceStage = value;
        index += 1;
        break;
      case '--expect-source-database':
        options.expectedDatabase = value;
        index += 1;
        break;
      case '--expect-source-host':
        options.expectedHost = value;
        index += 1;
        break;
      case '--expect-source-port':
        options.expectedPort = Number(value);
        index += 1;
        break;
      case '--check':
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function required(value: string | number | undefined, label: string): string | number {
  if (value === undefined || value === '' || (typeof value === 'number' && !Number.isInteger(value))) {
    throw new Error(`${label} is required`);
  }
  return value;
}

export async function runSnapshotCli(argv = process.argv, env = process.env): Promise<void> {
  const options = parseArgs(argv);
  const databaseUrl = required(env.CATALOG_SOURCE_DATABASE_URL, 'CATALOG_SOURCE_DATABASE_URL') as string;
  const expected: DatabaseIdentity = {
    database: required(options.expectedDatabase, '--expect-source-database') as string,
    host: required(options.expectedHost, '--expect-source-host') as string,
    port: required(options.expectedPort, '--expect-source-port') as number,
  };
  const sourceStage = required(options.sourceStage, '--source-stage') as string;
  if (options.export && !options.out) throw new Error('--out is required with --export');

  const client = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    const snapshot = await readCatalogSnapshot(client, expected, sourceStage);
    const summary = {
      schemaVersion: snapshot.manifest.schemaVersion,
      generatedAt: snapshot.manifest.generatedAt,
      source: snapshot.manifest.source,
      counts: snapshot.manifest.counts,
      normalizations: snapshot.manifest.normalizations.map((item) => ({
        table: item.table,
        column: item.column,
        parentTable: item.parentTable,
        count: item.count,
        sha256: item.sha256,
      })),
      sourceSkuCount: snapshot.manifest.skuIds.length,
      skuIdSha256: snapshot.manifest.skuIdSha256,
      contentSha256: snapshot.manifest.contentSha256,
    };
    if (options.export) {
      const outputPath = resolve(options.out!);
      await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      console.log(JSON.stringify({ mode: 'export', outputPath, manifest: summary }, null, 2));
    } else {
      console.log(JSON.stringify({ mode: 'check', manifest: summary }, null, 2));
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  runSnapshotCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
