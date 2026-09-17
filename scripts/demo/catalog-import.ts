import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';
import type { Sql } from 'postgres';
import { DEMO_LOGISTICS_FIXTURE } from '../../libs/shared/src/demo-logistics.fixture';
import {
  CATALOG_TABLES,
  DEMO_FIXTURE_HOLDER_ID,
  assertDemoTarget,
  assertSnapshot,
  deterministicCatalogIds,
  getCatalogTablePolicy,
  type CatalogColumn,
  type CatalogRow,
  type CatalogSnapshot,
  type CatalogTableName,
  type CatalogTablePolicy,
  type DatabaseIdentity,
} from './catalog-policy';

const DEFAULT_BATCH_SIZE = 1_000;

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) throw new Error(`Unsafe SQL identifier: ${identifier}`);
  return `"${identifier}"`;
}

interface ImportTablePolicy extends CatalogTablePolicy {
  columns: readonly CatalogColumn[];
}

function effectivePolicy(name: CatalogTableName): ImportTablePolicy {
  const source = getCatalogTablePolicy(name);
  if (name === 'suppliers') {
    return { ...source, columns: [...source.columns, { name: 'default_warehouse_id', pgType: 'uuid', update: true }] };
  }
  if (name === 'skus') {
    return {
      ...source,
      columns: [
        ...source.columns,
        { name: 'holder_id', pgType: 'uuid', update: true },
        { name: 'delivery_profile_id', pgType: 'uuid', update: true },
        { name: 'primary_location_id', pgType: 'uuid', update: true },
        { name: 'secondary_location_id', pgType: 'uuid', update: true },
      ],
    };
  }
  return source;
}

function buildUpsert(policy: ImportTablePolicy): string {
  const deferred = new Set(policy.deferredColumns ?? []);
  const columns = policy.columns.filter((column) => !deferred.has(column.name));
  const names = columns.map((column) => quoteIdentifier(column.name));
  const record = columns.map((column) => `${quoteIdentifier(column.name)} ${column.pgType}`).join(', ');
  const updates = columns
    .filter((column) => column.update !== false && !policy.conflictColumns.includes(column.name))
    .map((column) => `${quoteIdentifier(column.name)} = EXCLUDED.${quoteIdentifier(column.name)}`);
  const conflict = policy.conflictColumns.map(quoteIdentifier).join(', ');
  const onConflict = updates.length ? `DO UPDATE SET ${updates.join(', ')}` : 'DO NOTHING';
  return (
    `INSERT INTO ${quoteIdentifier(policy.name)} (${names.join(', ')}) ` +
    `SELECT ${names.join(', ')} FROM jsonb_to_recordset($1::jsonb) AS x(${record}) ` +
    `ON CONFLICT (${conflict}) ${onConflict}`
  );
}

export function buildSetBasedUpsert(name: CatalogTableName): string {
  return buildUpsert(getCatalogTablePolicy(name));
}

export function buildCatalogAnalyzeSql(): string {
  return `ANALYZE ${CATALOG_TABLES.map((table) => quoteIdentifier(table.name)).join(', ')}`;
}

function fullRow(name: CatalogTableName, values: CatalogRow): CatalogRow {
  return Object.fromEntries(
    getCatalogTablePolicy(name).columns.map((column) => [column.name, values[column.name] ?? null]),
  );
}

export interface SyntheticCatalogLink {
  skuId: string;
  sourceDeleted: boolean;
  masterId: string;
  versionId: string;
  variantId: string;
  matchingId: string;
}

export interface CatalogFallbackPlan {
  tables: CatalogSnapshot['tables'];
  synthetic: SyntheticCatalogLink[];
  demoSupplierFallbackSkuIds: string[];
}

export function withTrainingFallbacks(snapshot: CatalogSnapshot): CatalogFallbackPlan {
  const tables = structuredClone(snapshot.tables);
  const activeMasters = new Set(
    tables.product_masters.filter((row) => row.deleted_at == null).map((row) => String(row.id)),
  );
  const activeVariants = new Set(
    tables.product_variants.filter((row) => row.status === 'active').map((row) => String(row.id)),
  );
  const activePhysicalVersions = new Set(
    tables.product_master_versions
      .filter(
        (row) =>
          row.status === 'active' &&
          row.fulfillment_kind === 'physical' &&
          row.deleted_at == null &&
          activeMasters.has(String(row.master_id)),
      )
      .map((row) => String(row.id)),
  );
  const usableMasterVariants = new Set(
    tables.product_master_variants
      .filter(
        (row) =>
          activePhysicalVersions.has(String(row.version_id)) &&
          activeMasters.has(String(row.master_id)) &&
          activeVariants.has(String(row.variant_id)),
      )
      .map((row) => `${String(row.master_id)}\u0000${String(row.variant_id)}`),
  );
  const usableMatchingIds = new Set(
    tables.product_matchings
      .filter(
        (row) =>
          row.status === 'matched' &&
          row.is_resolved === true &&
          usableMasterVariants.has(`${String(row.master_id)}\u0000${String(row.variant_id)}`),
      )
      .map((row) => String(row.id)),
  );
  const usableSkuIds = new Set(
    tables.product_variant_sku_links
      .filter((row) => usableMatchingIds.has(String(row.product_matching_id)))
      .map((row) => String(row.sku_id)),
  );
  const synthetic: SyntheticCatalogLink[] = [];
  const skuIdsWithSourceSupplier = new Set(tables.sku_suppliers.map((row) => String(row.sku_id)));
  const demoSupplierFallbackSkuIds: string[] = [];
  const createdAt = snapshot.manifest.generatedAt;

  for (const sku of tables.skus) {
    const skuId = String(sku.id);
    if (sku.stock_type === 'physical' && sku.is_deleted !== true && !skuIdsWithSourceSupplier.has(skuId)) {
      demoSupplierFallbackSkuIds.push(skuId);
      tables.sku_suppliers.push(
        fullRow('sku_suppliers', {
          sku_id: skuId,
          supplier_id: DEMO_LOGISTICS_FIXTURE.suppliers[0].id,
          supplier_sku: `DEMO-${String(sku.code)}`,
          created_at: createdAt,
        }),
      );
    }
    if (sku.stock_type !== 'physical' || usableSkuIds.has(skuId)) continue;
    const ids = deterministicCatalogIds(skuId);
    const sourceDeleted = sku.is_deleted === true;
    const status = sourceDeleted ? 'inactive' : 'active';
    const code = `DEMO-${skuId}`;
    synthetic.push({ skuId, sourceDeleted, ...ids });

    tables.product_masters.push(
      fullRow('product_masters', {
        id: ids.masterId,
        created_at: createdAt,
        deleted_at: sourceDeleted ? createdAt : null,
      }),
    );
    tables.product_master_versions.push(
      fullRow('product_master_versions', {
        id: ids.versionId,
        master_id: ids.masterId,
        version: 1,
        parent_version_id: null,
        status,
        name: String(sku.name),
        description: `Demo training catalog link for source SKU ${String(sku.code)}`,
        is_wholesale_only: false,
        is_membership_only: false,
        hide_membership_price_for_non_members: false,
        is_visible_to_members_only: false,
        is_overseas: false,
        product_type: 'regular_sale',
        fulfillment_kind: 'physical',
        product_code: code,
        supply_price: '10000',
        age_restriction: 0,
        min_quantity: 1,
        approval_status: 'draft',
        deleted_at: sourceDeleted ? createdAt : null,
        registration_date: createdAt,
        created_at: createdAt,
        updated_at: createdAt,
      }),
    );
    tables.product_variants.push(
      fullRow('product_variants', {
        id: ids.variantId,
        variant_name: String(sku.name),
        display_order: 0,
        status,
        is_default: true,
        variant_code: code,
        created_at: createdAt,
        updated_at: createdAt,
      }),
    );
    tables.product_master_variants.push(
      fullRow('product_master_variants', {
        id: ids.masterVariantId,
        master_id: ids.masterId,
        variant_id: ids.variantId,
        version_id: ids.versionId,
        created_at: createdAt,
      }),
    );
    tables.product_matchings.push(
      fullRow('product_matchings', {
        id: ids.matchingId,
        variant_id: ids.variantId,
        master_id: ids.masterId,
        sku_group_id: sku.group_id ?? null,
        status: 'matched',
        priority: 'normal',
        strategy: 'variant',
        is_resolved: true,
        pre_stock_sellable: false,
        always_sellable_zero_stock: false,
        created_at: createdAt,
        updated_at: createdAt,
      }),
    );
    tables.product_variant_sku_links.push(
      fullRow('product_variant_sku_links', {
        product_matching_id: ids.matchingId,
        sku_id: skuId,
        quantity: 1,
        created_at: createdAt,
      }),
    );
  }
  return { tables, synthetic, demoSupplierFallbackSkuIds };
}

function mappedRows(name: CatalogTableName, rows: CatalogRow[]): CatalogRow[] {
  if (name === 'suppliers') {
    return rows.map((row) => ({ ...row, default_warehouse_id: DEMO_LOGISTICS_FIXTURE.warehouses[0].id }));
  }
  if (name === 'skus') {
    return rows.map((row) => {
      const physical = row.stock_type === 'physical';
      return {
        ...row,
        holder_id: DEMO_FIXTURE_HOLDER_ID,
        delivery_profile_id: physical ? DEMO_LOGISTICS_FIXTURE.deliveryProfile.id : null,
        primary_location_id: physical ? DEMO_LOGISTICS_FIXTURE.locations[2].id : null,
        secondary_location_id: null,
      };
    });
  }
  return rows;
}

async function executeBatchedUpsert(
  tx: Sql,
  name: CatalogTableName,
  rows: CatalogRow[],
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<void> {
  if (!rows.length) return;
  const policy = effectivePolicy(name);
  const statement = buildUpsert(policy);
  const mapped = mappedRows(name, rows);
  for (let offset = 0; offset < mapped.length; offset += batchSize) {
    await tx.unsafe(statement, [mapped.slice(offset, offset + batchSize) as unknown as postgres.JSONValue]);
  }
}

async function restoreDeferredColumns(tx: Sql, name: CatalogTableName, rows: CatalogRow[]): Promise<void> {
  const policy = getCatalogTablePolicy(name);
  for (const deferredName of policy.deferredColumns ?? []) {
    const column = policy.columns.find((candidate) => candidate.name === deferredName)!;
    // Include NULL explicitly: a newer source snapshot may remove a parent relation that an earlier import set.
    const values = rows.map((row) => ({ id: row.id, value: row[deferredName] ?? null }));
    for (let offset = 0; offset < values.length; offset += DEFAULT_BATCH_SIZE) {
      await tx.unsafe(
        `UPDATE ${quoteIdentifier(name)} AS target SET ${quoteIdentifier(deferredName)} = source.value ` +
          `FROM jsonb_to_recordset($1::jsonb) AS source(id uuid, value ${column.pgType}) ` +
          `WHERE target.id = source.id`,
        [values.slice(offset, offset + DEFAULT_BATCH_SIZE) as unknown as postgres.JSONValue],
      );
    }
  }
}

interface AlternateKeyPolicy {
  table: CatalogTableName;
  columns: string[];
  predicate?: string;
}

const ALTERNATE_KEYS: AlternateKeyPolicy[] = [
  { table: 'skus', columns: ['code'] },
  { table: 'sku_groups', columns: ['code'] },
  { table: 'sku_barcodes', columns: ['barcode'] },
  { table: 'product_categories', columns: ['slug'] },
  { table: 'product_master_versions', columns: ['master_id', 'version'] },
  {
    table: 'product_master_versions',
    columns: ['master_id'],
    predicate: `target.status = 'active' AND source.status = 'active'`,
  },
  {
    table: 'product_master_versions',
    columns: ['product_code'],
    predicate: `target.status = 'active' AND source.status = 'active' AND source.product_code IS NOT NULL`,
  },
  { table: 'product_master_categories', columns: ['master_id', 'category_id', 'version_id'] },
  { table: 'product_master_option_groups', columns: ['master_id', 'option_group_id', 'version_id'] },
  { table: 'product_master_pricing_rules', columns: ['master_id', 'pricing_rule_id', 'version_id'] },
  { table: 'product_master_variants', columns: ['master_id', 'variant_id', 'version_id'] },
  { table: 'product_option_group_displays', columns: ['option_group_id', 'master_id', 'version_id', 'locale'] },
  { table: 'product_option_value_displays', columns: ['option_value_id', 'master_id', 'version_id', 'locale'] },
  { table: 'variant_option_values', columns: ['variant_id', 'option_value_id'] },
  { table: 'product_variant_price_cache', columns: ['version_id', 'variant_id'] },
  { table: 'product_master_purchase_constraints', columns: ['version_id'] },
  { table: 'product_matchings', columns: ['variant_id'] },
];

async function assertNoTargetCollisions(tx: Sql, tables: CatalogSnapshot['tables']): Promise<void> {
  for (const alternate of ALTERNATE_KEYS) {
    const rows = mappedRows(alternate.table, tables[alternate.table]);
    if (!rows.length) continue;
    const policy = effectivePolicy(alternate.table);
    const required = new Set([...policy.conflictColumns, ...alternate.columns]);
    if (alternate.predicate) {
      for (const token of alternate.predicate.match(/source\.([a-z_]+)/g) ?? [])
        required.add(token.slice('source.'.length));
    }
    const columns = policy.columns.filter((column) => required.has(column.name));
    const projectedRows = rows.map((row) =>
      Object.fromEntries(columns.map((column) => [column.name, row[column.name] ?? null])),
    );
    const record = columns.map((column) => `${quoteIdentifier(column.name)} ${column.pgType}`).join(', ');
    const joins = alternate.columns
      .map((column) => `target.${quoteIdentifier(column)} = source.${quoteIdentifier(column)}`)
      .join(' AND ');
    const differs = policy.conflictColumns
      .map((column) => `target.${quoteIdentifier(column)} IS DISTINCT FROM source.${quoteIdentifier(column)}`)
      .join(' OR ');
    const where = alternate.predicate ? `AND (${alternate.predicate})` : '';
    for (let offset = 0; offset < projectedRows.length; offset += DEFAULT_BATCH_SIZE) {
      let result: { count: number };
      try {
        [result] = await tx.unsafe<{ count: number }[]>(
          `SELECT count(*)::int AS count FROM jsonb_to_recordset($1::jsonb) AS source(${record}) ` +
            `JOIN ${quoteIdentifier(alternate.table)} AS target ON ${joins} WHERE (${differs}) ${where}`,
          [projectedRows.slice(offset, offset + DEFAULT_BATCH_SIZE) as unknown as postgres.JSONValue],
        );
      } catch (error) {
        throw new Error(`Target collision preflight failed for ${alternate.table}: ${String(error)}`, {
          cause: error,
        });
      }
      if (Number(result.count) > 0) {
        throw new Error(`Target collision in ${alternate.table} alternate key (${alternate.columns.join(', ')})`);
      }
    }
  }
}

export interface CatalogImportReport {
  snapshotId: string;
  mode: 'dry-run' | 'apply';
  source: CatalogSnapshot['manifest']['source'];
  target: DatabaseIdentity;
  sourceCounts: CatalogSnapshot['manifest']['counts'];
  sourceNormalizations: CatalogSnapshot['manifest']['normalizations'];
  sourceSkuCount: number;
  importedSkuCount: number;
  missingSourceSkuIds: string[];
  deletedStatusMismatchSkuIds: string[];
  syntheticCatalogLinks: SyntheticCatalogLink[];
  demoSupplierFallbackSkuIds: string[];
  imageReferencesRequireFileServiceValidation: number;
  deactivatedSupersededFallbacks: number;
  removedSupersededDemoSupplierFallbacks: number;
  removedSourceRelationRows: Partial<Record<CatalogTableName, number>>;
}

const RECONCILED_SOURCE_RELATIONS: readonly CatalogTableName[] = [
  'sku_suppliers',
  'sku_categories',
  'product_master_categories',
  'product_master_option_groups',
  'product_master_variants',
  'variant_option_values',
  'product_master_pricing_rules',
  'product_variant_sku_links',
];

type SourceRelationKeys = Partial<Record<CatalogTableName, CatalogRow[]>>;

function sourceRelationKeys(snapshot: CatalogSnapshot): SourceRelationKeys {
  return Object.fromEntries(
    RECONCILED_SOURCE_RELATIONS.map((name) => {
      const policy = getCatalogTablePolicy(name);
      return [
        name,
        snapshot.tables[name].map((row) =>
          Object.fromEntries(policy.conflictColumns.map((column) => [column, row[column] ?? null])),
        ),
      ];
    }),
  );
}

function keyString(policy: CatalogTablePolicy, row: CatalogRow): string {
  return JSON.stringify(policy.conflictColumns.map((column) => row[column] ?? null));
}

async function reconcileRemovedSourceRelations(
  tx: Sql,
  previous: SourceRelationKeys | null,
  current: SourceRelationKeys,
): Promise<Partial<Record<CatalogTableName, number>>> {
  const removedCounts: Partial<Record<CatalogTableName, number>> = {};
  if (!previous) return removedCounts;
  for (const name of RECONCILED_SOURCE_RELATIONS) {
    const policy = getCatalogTablePolicy(name);
    const currentKeys = new Set((current[name] ?? []).map((row) => keyString(policy, row)));
    const removed = (previous[name] ?? []).filter((row) => !currentKeys.has(keyString(policy, row)));
    if (!removed.length) continue;
    const columns = policy.columns.filter((column) => policy.conflictColumns.includes(column.name));
    const record = columns.map((column) => `${quoteIdentifier(column.name)} ${column.pgType}`).join(', ');
    const joins = policy.conflictColumns
      .map((column) => `target.${quoteIdentifier(column)} = source.${quoteIdentifier(column)}`)
      .join(' AND ');
    let count = 0;
    for (let offset = 0; offset < removed.length; offset += DEFAULT_BATCH_SIZE) {
      const result = await tx.unsafe<{ count: number }[]>(
        `WITH deleted AS (DELETE FROM ${quoteIdentifier(name)} AS target ` +
          `USING jsonb_to_recordset($1::jsonb) AS source(${record}) WHERE ${joins} RETURNING 1) ` +
          `SELECT count(*)::int AS count FROM deleted`,
        [removed.slice(offset, offset + DEFAULT_BATCH_SIZE) as unknown as postgres.JSONValue],
      );
      count += Number(result[0].count);
    }
    removedCounts[name] = count;
  }
  return removedCounts;
}

async function deactivateSupersededFallbacks(
  tx: Sql,
  snapshot: CatalogSnapshot,
  synthetic: SyntheticCatalogLink[],
): Promise<number> {
  const currentFallbackSkuIds = new Set(synthetic.map((item) => item.skuId));
  const ids = snapshot.tables.skus
    .filter((row) => !currentFallbackSkuIds.has(String(row.id)))
    .map((row) => deterministicCatalogIds(String(row.id)));
  if (!ids.length) return 0;
  const variantIds = ids.map((item) => item.variantId);
  const versionIds = ids.map((item) => item.versionId);
  const variants = await tx<{ id: string }[]>`
    UPDATE product_variants SET status = 'inactive', updated_at = now()
    WHERE id = ANY(${variantIds}::uuid[]) AND status IS DISTINCT FROM 'inactive'
    RETURNING id::text
  `;
  await tx`
    UPDATE product_master_versions SET status = 'inactive', updated_at = now()
    WHERE id = ANY(${versionIds}::uuid[]) AND status IS DISTINCT FROM 'inactive'
  `;
  return variants.length;
}

async function suppressSupplierFallbacksCoveredInTarget(tx: Sql, plan: CatalogFallbackPlan): Promise<string[]> {
  if (!plan.demoSupplierFallbackSkuIds.length) return [];
  const covered = await tx<{ sku_id: string }[]>`
    SELECT DISTINCT sku_id::text AS sku_id
    FROM sku_suppliers
    WHERE sku_id = ANY(${plan.demoSupplierFallbackSkuIds}::uuid[])
      AND supplier_id <> ${DEMO_LOGISTICS_FIXTURE.suppliers[0].id}
  `;
  const coveredIds = new Set(covered.map((row) => row.sku_id));
  if (!coveredIds.size) return plan.demoSupplierFallbackSkuIds;
  plan.tables.sku_suppliers = plan.tables.sku_suppliers.filter(
    (row) => row.supplier_id !== DEMO_LOGISTICS_FIXTURE.suppliers[0].id || !coveredIds.has(String(row.sku_id)),
  );
  plan.demoSupplierFallbackSkuIds = plan.demoSupplierFallbackSkuIds.filter((id) => !coveredIds.has(id));
  return plan.demoSupplierFallbackSkuIds;
}

async function removeSupersededSupplierFallbacks(
  tx: Sql,
  previousSkuIds: string[] | null,
  currentSkuIds: string[],
): Promise<number> {
  if (!previousSkuIds?.length) return 0;
  const current = new Set(currentSkuIds);
  const removed = previousSkuIds.filter((id) => !current.has(id));
  if (!removed.length) return 0;
  const rows = await tx<{ sku_id: string }[]>`
    DELETE FROM sku_suppliers
    WHERE supplier_id = ${DEMO_LOGISTICS_FIXTURE.suppliers[0].id}
      AND sku_id = ANY(${removed}::uuid[])
    RETURNING sku_id::text
  `;
  return rows.length;
}

function imageReferenceCount(snapshot: CatalogSnapshot): number {
  return (
    snapshot.tables.sku_images.length +
    snapshot.tables.product_images.length +
    snapshot.tables.product_variants.filter((row) => row.image_id != null).length
  );
}

async function probeTarget(
  client: Sql,
  expected: DatabaseIdentity,
  connected: DatabaseIdentity | undefined,
  expectedConnected: DatabaseIdentity | undefined,
  stage: string,
  externalIntegrationsMode: string,
): Promise<DatabaseIdentity> {
  const [identity] = await client<{ database: string; host: string; port: number }[]>`
    SELECT current_database() AS database,
           COALESCE(host(inet_server_addr()), 'local') AS host,
           inet_server_port()::int AS port
  `;
  const [fixture] = await client<{ fixture_rows: number }[]>`
    SELECT count(*)::int AS fixture_rows
    FROM (
      SELECT 1 WHERE EXISTS (SELECT 1 FROM holders WHERE id = ${DEMO_FIXTURE_HOLDER_ID})
      UNION ALL
      SELECT 1 WHERE EXISTS (
        SELECT 1 FROM delivery_profiles
        WHERE id = ${DEMO_LOGISTICS_FIXTURE.deliveryProfile.id} AND carrier_account_ref = 'demo-mock'
      )
      UNION ALL
      SELECT 1 WHERE EXISTS (SELECT 1 FROM warehouses WHERE id = ${DEMO_LOGISTICS_FIXTURE.warehouses[0].id})
      UNION ALL
      SELECT 1 WHERE EXISTS (SELECT 1 FROM locations WHERE id = ${DEMO_LOGISTICS_FIXTURE.locations[2].id})
      UNION ALL
      SELECT 1 WHERE EXISTS (
        SELECT 1 FROM suppliers
        WHERE id = ${DEMO_LOGISTICS_FIXTURE.suppliers[0].id}
          AND code = ${DEMO_LOGISTICS_FIXTURE.suppliers[0].code}
          AND default_warehouse_id = ${DEMO_LOGISTICS_FIXTURE.warehouses[0].id}
      )
    ) AS markers
  `;
  if (connected && connected.database !== identity.database) {
    throw new Error(`Connected target database mismatch: endpoint=${connected.database}, server=${identity.database}`);
  }
  if (connected && expectedConnected) {
    const endpointMatches =
      connected.database === expectedConnected.database &&
      connected.host === expectedConnected.host &&
      connected.port === expectedConnected.port;
    if (!endpointMatches) throw new Error('Connected target endpoint binding mismatch');
  }
  const actual = { database: identity.database, host: identity.host, port: Number(identity.port) };
  assertDemoTarget({ stage, externalIntegrationsMode, actual, expected, fixtureRows: Number(fixture.fixture_rows) });
  return actual;
}

async function verifySkuCompleteness(
  tx: Sql,
  snapshot: CatalogSnapshot,
): Promise<{ imported: string[]; missing: string[]; deletedMismatch: string[] }> {
  const rows = await tx<{ id: string; is_deleted: boolean | null }[]>`
    SELECT target.id::text AS id, target.is_deleted
    FROM jsonb_array_elements_text(${tx.json(snapshot.manifest.skuIds)}::jsonb) AS source(id)
    LEFT JOIN skus AS target ON target.id = source.id::uuid
    ORDER BY source.id
  `;
  const expectedDeleted = new Map(snapshot.tables.skus.map((row) => [String(row.id), Boolean(row.is_deleted)]));
  const imported = rows.filter((row) => row.id !== null).map((row) => row.id);
  const importedSet = new Set(imported);
  return {
    imported,
    missing: snapshot.manifest.skuIds.filter((id) => !importedSet.has(id)),
    deletedMismatch: rows
      .filter((row) => row.id !== null && Boolean(row.is_deleted) !== expectedDeleted.get(row.id))
      .map((row) => row.id),
  };
}

async function ensureMetadataTable(tx: Sql): Promise<void> {
  await tx.unsafe(`
    CREATE TABLE IF NOT EXISTS demo_catalog_imports (
      snapshot_id text PRIMARY KEY,
      schema_version integer NOT NULL,
      source_identity jsonb NOT NULL,
      target_identity jsonb NOT NULL,
      source_counts jsonb NOT NULL,
      source_sku_ids jsonb NOT NULL,
      imported_sku_ids jsonb NOT NULL,
      content_sha256 text NOT NULL,
      source_generated_at timestamptz,
      source_relation_keys jsonb,
      demo_supplier_fallback_sku_ids jsonb,
      report jsonb NOT NULL,
      imported_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await tx.unsafe('ALTER TABLE demo_catalog_imports ADD COLUMN IF NOT EXISTS source_generated_at timestamptz');
  await tx.unsafe('ALTER TABLE demo_catalog_imports ADD COLUMN IF NOT EXISTS source_relation_keys jsonb');
  await tx.unsafe('ALTER TABLE demo_catalog_imports ADD COLUMN IF NOT EXISTS demo_supplier_fallback_sku_ids jsonb');
}

async function latestSourceImport(
  tx: Sql,
  snapshot: CatalogSnapshot,
): Promise<{
  source_generated_at: Date | string | null;
  source_relation_keys: SourceRelationKeys | null;
  demo_supplier_fallback_sku_ids: string[] | null;
} | null> {
  const [exists] = await tx<{ present: boolean }[]>`
    SELECT to_regclass('demo_catalog_imports') IS NOT NULL AS present
  `;
  if (!exists.present) return null;
  const [hasColumns] = await tx<{ count: number }[]>`
    SELECT count(*)::int AS count FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'demo_catalog_imports'
      AND column_name IN ('source_generated_at', 'source_relation_keys', 'demo_supplier_fallback_sku_ids')
  `;
  if (Number(hasColumns.count) !== 3) return null;
  const rows = await tx<
    {
      source_generated_at: Date | string | null;
      source_relation_keys: SourceRelationKeys | null;
      demo_supplier_fallback_sku_ids: string[] | null;
    }[]
  >`
    SELECT source_generated_at, source_relation_keys, demo_supplier_fallback_sku_ids
    FROM demo_catalog_imports
    WHERE source_identity->>'database' = ${snapshot.manifest.source.database}
      AND source_identity->>'stage' = ${snapshot.manifest.source.stage}
      AND source_generated_at IS NOT NULL
    ORDER BY source_generated_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export function assertSnapshotIsCurrent(
  snapshot: CatalogSnapshot,
  previous: Awaited<ReturnType<typeof latestSourceImport>>,
): void {
  if (!previous?.source_generated_at) return;
  if (new Date(snapshot.manifest.generatedAt).getTime() < new Date(previous.source_generated_at).getTime()) {
    throw new Error(
      `Snapshot is older than the latest imported source extraction (${snapshot.manifest.generatedAt} < ` +
        `${new Date(previous.source_generated_at).toISOString()})`,
    );
  }
}

export async function importCatalogSnapshot(
  client: Sql,
  snapshot: CatalogSnapshot,
  options: {
    stage: string;
    externalIntegrationsMode: string;
    expectedTarget: DatabaseIdentity;
    connectedTarget?: DatabaseIdentity;
    expectedConnectedTarget?: DatabaseIdentity;
    apply?: boolean;
    batchSize?: number;
  },
): Promise<CatalogImportReport> {
  assertSnapshot(snapshot);
  const target = await probeTarget(
    client,
    options.expectedTarget,
    options.connectedTarget,
    options.expectedConnectedTarget,
    options.stage,
    options.externalIntegrationsMode,
  );
  const fallbackPlan = withTrainingFallbacks(snapshot);
  const { tables, synthetic } = fallbackPlan;

  return client.begin('ISOLATION LEVEL SERIALIZABLE', async (transaction) => {
    const tx = transaction as unknown as Sql;
    const previousImport = await latestSourceImport(tx, snapshot);
    assertSnapshotIsCurrent(snapshot, previousImport);
    const demoSupplierFallbackSkuIds = await suppressSupplierFallbacksCoveredInTarget(tx, fallbackPlan);
    await assertNoTargetCollisions(tx, tables);
    if (!options.apply) {
      const currentCompleteness = await verifySkuCompleteness(tx, snapshot);
      return {
        snapshotId: snapshot.manifest.contentSha256,
        mode: 'dry-run',
        source: snapshot.manifest.source,
        target,
        sourceCounts: snapshot.manifest.counts,
        sourceNormalizations: snapshot.manifest.normalizations,
        sourceSkuCount: snapshot.manifest.skuIds.length,
        importedSkuCount: currentCompleteness.imported.length,
        missingSourceSkuIds: currentCompleteness.missing,
        deletedStatusMismatchSkuIds: currentCompleteness.deletedMismatch,
        syntheticCatalogLinks: synthetic,
        demoSupplierFallbackSkuIds,
        imageReferencesRequireFileServiceValidation: imageReferenceCount(snapshot),
        deactivatedSupersededFallbacks: 0,
        removedSupersededDemoSupplierFallbacks: 0,
        removedSourceRelationRows: {},
      };
    }

    await ensureMetadataTable(tx);
    const relationKeys = sourceRelationKeys(snapshot);
    const removedSourceRelationRows = await reconcileRemovedSourceRelations(
      tx,
      previousImport?.source_relation_keys ?? null,
      relationKeys,
    );
    const removedSupersededDemoSupplierFallbacks = await removeSupersededSupplierFallbacks(
      tx,
      previousImport?.demo_supplier_fallback_sku_ids ?? null,
      demoSupplierFallbackSkuIds,
    );
    for (const table of CATALOG_TABLES) {
      await executeBatchedUpsert(tx, table.name, tables[table.name], options.batchSize ?? DEFAULT_BATCH_SIZE);
    }
    for (const table of CATALOG_TABLES) {
      if (table.deferredColumns?.length) await restoreDeferredColumns(tx, table.name, tables[table.name]);
    }
    const deactivatedSupersededFallbacks = await deactivateSupersededFallbacks(tx, snapshot, synthetic);
    const completeness = await verifySkuCompleteness(tx, snapshot);
    if (completeness.missing.length || completeness.deletedMismatch.length) {
      throw new Error(
        `SKU completeness validation failed (missing=${completeness.missing.length}, ` +
          `deletedStatusMismatch=${completeness.deletedMismatch.length})`,
      );
    }
    const report: CatalogImportReport = {
      snapshotId: snapshot.manifest.contentSha256,
      mode: 'apply',
      source: snapshot.manifest.source,
      target,
      sourceCounts: snapshot.manifest.counts,
      sourceNormalizations: snapshot.manifest.normalizations,
      sourceSkuCount: snapshot.manifest.skuIds.length,
      importedSkuCount: completeness.imported.length,
      missingSourceSkuIds: completeness.missing,
      deletedStatusMismatchSkuIds: completeness.deletedMismatch,
      syntheticCatalogLinks: synthetic,
      demoSupplierFallbackSkuIds,
      imageReferencesRequireFileServiceValidation: imageReferenceCount(snapshot),
      deactivatedSupersededFallbacks,
      removedSupersededDemoSupplierFallbacks,
      removedSourceRelationRows,
    };
    await tx`
      INSERT INTO demo_catalog_imports (
        snapshot_id, schema_version, source_identity, target_identity, source_counts,
        source_sku_ids, imported_sku_ids, content_sha256, source_generated_at, source_relation_keys,
        demo_supplier_fallback_sku_ids, report, imported_at
      ) VALUES (
        ${snapshot.manifest.contentSha256}, ${snapshot.manifest.schemaVersion},
        ${tx.json(snapshot.manifest.source as unknown as postgres.JSONValue)}::jsonb,
        ${tx.json(target as unknown as postgres.JSONValue)}::jsonb,
        ${tx.json(snapshot.manifest.counts)}::jsonb, ${tx.json(snapshot.manifest.skuIds)}::jsonb,
        ${tx.json(completeness.imported)}::jsonb, ${snapshot.manifest.contentSha256},
        ${snapshot.manifest.generatedAt}::timestamptz,
        ${tx.json(relationKeys as unknown as postgres.JSONValue)}::jsonb,
        ${tx.json(demoSupplierFallbackSkuIds)}::jsonb,
        ${tx.json(report as unknown as postgres.JSONValue)}::jsonb, now()
      )
      ON CONFLICT (snapshot_id) DO UPDATE SET
        target_identity = EXCLUDED.target_identity,
        source_counts = EXCLUDED.source_counts,
        source_sku_ids = EXCLUDED.source_sku_ids,
        imported_sku_ids = EXCLUDED.imported_sku_ids,
        source_generated_at = EXCLUDED.source_generated_at,
        source_relation_keys = EXCLUDED.source_relation_keys,
        demo_supplier_fallback_sku_ids = EXCLUDED.demo_supplier_fallback_sku_ids,
        report = EXCLUDED.report,
        imported_at = now()
    `;
    await tx.unsafe(buildCatalogAnalyzeSql());
    return report;
  });
}

interface ImportCliOptions {
  snapshot?: string;
  report?: string;
  apply: boolean;
  analyzeOnly: boolean;
  stage?: string;
  externalIntegrationsMode?: string;
  expectedDatabase?: string;
  expectedHost?: string;
  expectedPort?: number;
  expectedConnectedHost?: string;
  expectedConnectedPort?: number;
}

function parseArgs(argv: string[]): ImportCliOptions {
  const options: ImportCliOptions = { apply: false, analyzeOnly: false };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    switch (arg) {
      case '--snapshot':
        options.snapshot = value;
        index += 1;
        break;
      case '--report':
        options.report = value;
        index += 1;
        break;
      case '--apply':
        options.apply = true;
        break;
      case '--analyze-only':
        options.analyzeOnly = true;
        break;
      case '--check':
        break;
      case '--target-stage':
        options.stage = value;
        index += 1;
        break;
      case '--external-integrations-mode':
        options.externalIntegrationsMode = value;
        index += 1;
        break;
      case '--expect-target-database':
        options.expectedDatabase = value;
        index += 1;
        break;
      case '--expect-target-host':
        options.expectedHost = value;
        index += 1;
        break;
      case '--expect-target-port':
        options.expectedPort = Number(value);
        index += 1;
        break;
      case '--expect-target-connected-host':
        options.expectedConnectedHost = value;
        index += 1;
        break;
      case '--expect-target-connected-port':
        options.expectedConnectedPort = Number(value);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined || value === '' || (typeof value === 'number' && !Number.isInteger(value))) {
    throw new Error(`${label} is required`);
  }
  return value;
}

export async function runImportCli(argv = process.argv, env = process.env): Promise<void> {
  const options = parseArgs(argv);
  if (options.apply && options.analyzeOnly) throw new Error('--apply and --analyze-only are mutually exclusive');
  const databaseUrl = requireValue(env.CATALOG_TARGET_DATABASE_URL, 'CATALOG_TARGET_DATABASE_URL');
  const client = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => undefined });
  const connectedUrl = new URL(databaseUrl);
  try {
    const targetOptions = {
      stage: requireValue(options.stage, '--target-stage'),
      externalIntegrationsMode: requireValue(options.externalIntegrationsMode, '--external-integrations-mode'),
      expectedTarget: {
        database: requireValue(options.expectedDatabase, '--expect-target-database'),
        host: requireValue(options.expectedHost, '--expect-target-host'),
        port: requireValue(options.expectedPort, '--expect-target-port'),
      },
      connectedTarget: {
        database: decodeURIComponent(connectedUrl.pathname.slice(1)),
        host: connectedUrl.hostname,
        port: Number(connectedUrl.port || 5432),
      },
      expectedConnectedTarget: {
        database: requireValue(options.expectedDatabase, '--expect-target-database'),
        host: requireValue(options.expectedConnectedHost, '--expect-target-connected-host'),
        port: requireValue(options.expectedConnectedPort, '--expect-target-connected-port'),
      },
    };
    if (options.analyzeOnly) {
      await probeTarget(
        client,
        targetOptions.expectedTarget,
        targetOptions.connectedTarget,
        targetOptions.expectedConnectedTarget,
        targetOptions.stage,
        targetOptions.externalIntegrationsMode,
      );
      await client.unsafe(buildCatalogAnalyzeSql());
      console.log(JSON.stringify({ mode: 'analyze-only', tableCount: CATALOG_TABLES.length }, null, 2));
      return;
    }
    const snapshotPath = resolve(requireValue(options.snapshot, '--snapshot'));
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as CatalogSnapshot;
    const report = await importCatalogSnapshot(client, snapshot, {
      ...targetOptions,
      apply: options.apply,
    });
    if (options.report) {
      await writeFile(resolve(options.report), `${JSON.stringify(report, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
    }
    console.log(
      JSON.stringify(
        {
          mode: report.mode,
          snapshotId: report.snapshotId,
          sourceSkuCount: report.sourceSkuCount,
          importedSkuCount: report.importedSkuCount,
          syntheticCatalogLinkCount: report.syntheticCatalogLinks.length,
          demoSupplierFallbackSkuCount: report.demoSupplierFallbackSkuIds.length,
          missingSourceSkuCount: report.missingSourceSkuIds.length,
          deletedStatusMismatchCount: report.deletedStatusMismatchSkuIds.length,
          imageReferencesRequireFileServiceValidation: report.imageReferencesRequireFileServiceValidation,
          sourceNormalizationCount: report.sourceNormalizations.length,
          sourceNormalizedRowCount: report.sourceNormalizations.reduce((sum, item) => sum + item.count, 0),
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  runImportCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
