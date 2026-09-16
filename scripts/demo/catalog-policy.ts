import { createHash } from 'node:crypto';
import { DEMO_LOGISTICS_FIXTURE } from '../../libs/shared/src/demo-logistics.fixture';

export const SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const DEMO_FIXTURE_HOLDER_ID = '019f1009-0900-7000-a000-000000000900';

export type CatalogTableName =
  | 'suppliers'
  | 'supplier_lead_time_profiles'
  | 'replenishment_supplier_rules'
  | 'sku_groups'
  | 'categories'
  | 'product_categories'
  | 'product_masters'
  | 'product_option_groups'
  | 'product_option_values'
  | 'product_variants'
  | 'product_master_versions'
  | 'skus'
  | 'sku_suppliers'
  | 'sku_barcodes'
  | 'sku_images'
  | 'sku_categories'
  | 'product_master_categories'
  | 'product_master_option_groups'
  | 'product_master_variants'
  | 'product_option_group_displays'
  | 'product_option_value_displays'
  | 'variant_option_values'
  | 'pricing_rules'
  | 'product_master_pricing_rules'
  | 'product_variant_price_cache'
  | 'product_images'
  | 'product_purchase_constraints'
  | 'product_master_purchase_constraints'
  | 'product_matchings'
  | 'product_variant_sku_links';

export interface CatalogColumn {
  name: string;
  pgType: string;
  update?: boolean;
}

export interface CatalogTablePolicy {
  name: CatalogTableName;
  columns: readonly CatalogColumn[];
  conflictColumns: readonly string[];
  /** Columns that are inserted as NULL first and restored after dependency rows exist. */
  deferredColumns?: readonly string[];
}

const c = (name: string, pgType: string, update = true): CatalogColumn => ({ name, pgType, update });

/**
 * Security boundary for both SELECT and INSERT. The list is intentionally hand-written from the current
 * Core Drizzle schemas. In particular, supplier contacts/bank data, people identifiers, notes, sales history,
 * stock, reservations, orders and work tables are absent.
 */
export const CATALOG_TABLES: readonly CatalogTablePolicy[] = [
  {
    name: 'suppliers',
    conflictColumns: ['id'],
    columns: [
      c('id', 'uuid', false),
      c('name', 'varchar'),
      c('code', 'varchar'),
      c('is_direct_delivery', 'boolean'),
      c('order_cutoff_time', 'varchar'),
      c('payment_method', 'varchar'),
      c('created_at', 'timestamptz'),
      c('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'supplier_lead_time_profiles',
    conflictColumns: ['supplier_id'],
    columns: [
      c('supplier_id', 'uuid', false),
      c('observations', 'integer'),
      c('mean_days', 'double precision'),
      c('std_days', 'double precision'),
      c('window_from', 'date'),
      c('window_to', 'date'),
      c('computed_at', 'timestamptz'),
      c('created_at', 'timestamptz'),
      c('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'replenishment_supplier_rules',
    conflictColumns: ['supplier_id'],
    columns: [
      c('supplier_id', 'uuid', false),
      c('lead_time_days', 'double precision'),
      c('lead_time_std_days', 'double precision'),
      c('cover_days', 'integer'),
      c('created_at', 'timestamptz'),
      c('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'sku_groups',
    conflictColumns: ['id'],
    columns: [
      c('id', 'uuid', false),
      c('name', 'varchar'),
      c('code', 'varchar'),
      c('created_at', 'timestamptz'),
      c('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'categories',
    conflictColumns: ['id'],
    columns: [
      c('id', 'uuid', false),
      c('name', 'varchar'),
      c('created_at', 'timestamptz'),
      c('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'product_categories',
    conflictColumns: ['id'],
    deferredColumns: ['parent_id'],
    columns: [
      c('id', 'uuid', false),
      c('name', 'varchar'),
      c('description', 'text'),
      c('slug', 'varchar'),
      c('image_url', 'text'),
      c('parent_id', 'uuid'),
      c('level', 'integer'),
      c('path', 'varchar'),
      c('sort_order', 'integer'),
      c('is_active', 'boolean'),
      c('visibility', 'boolean'),
      c('display_settings', 'jsonb'),
      c('seo_config', 'jsonb'),
      c('created_at', 'timestamp'),
      c('updated_at', 'timestamp'),
    ],
  },
  {
    name: 'product_masters',
    conflictColumns: ['id'],
    columns: [c('id', 'uuid', false), c('created_at', 'timestamp'), c('deleted_at', 'timestamp')],
  },
  {
    name: 'product_option_groups',
    conflictColumns: ['id'],
    columns: [c('id', 'uuid', false), c('created_at', 'timestamp')],
  },
  {
    name: 'product_option_values',
    conflictColumns: ['id'],
    columns: [c('id', 'uuid', false), c('option_group_id', 'uuid'), c('created_at', 'timestamp')],
  },
  {
    name: 'product_variants',
    conflictColumns: ['id'],
    columns: [
      c('id', 'uuid', false),
      c('variant_name', 'varchar'),
      c('image_id', 'uuid'),
      c('display_order', 'integer'),
      c('status', 'varchar'),
      c('is_default', 'boolean'),
      c('variant_code', 'varchar'),
      c('created_at', 'timestamp'),
      c('updated_at', 'timestamp'),
    ],
  },
  {
    name: 'product_master_versions',
    conflictColumns: ['id'],
    deferredColumns: ['parent_version_id'],
    columns: [
      c('id', 'uuid', false),
      c('master_id', 'uuid'),
      c('version', 'integer'),
      c('parent_version_id', 'uuid'),
      c('status', 'product_master_version_status'),
      c('name', 'varchar'),
      c('description', 'text'),
      c('brand', 'varchar'),
      c('thumbnail', 'text'),
      c('seo_title', 'varchar'),
      c('seo_description', 'text'),
      c('seo_keywords', 'text[]'),
      c('description_html', 'text'),
      c('is_wholesale_only', 'boolean'),
      c('is_membership_only', 'boolean'),
      c('hide_membership_price_for_non_members', 'boolean'),
      c('is_visible_to_members_only', 'boolean'),
      c('is_overseas', 'boolean'),
      c('product_type', 'varchar'),
      c('fulfillment_kind', 'varchar'),
      c('product_code', 'varchar'),
      c('alternative_name', 'varchar'),
      c('material', 'text'),
      c('product_info', 'jsonb'),
      c('sales_classification', 'varchar'),
      c('purchase_classification', 'varchar'),
      c('shipping_group_code', 'varchar'),
      c('market_price', 'bigint'),
      c('supply_price', 'bigint'),
      c('supplier_id', 'uuid'),
      c('age_restriction', 'integer'),
      c('min_quantity', 'integer'),
      c('max_quantity', 'integer'),
      c('sales_start_date', 'timestamp'),
      c('sales_end_date', 'timestamp'),
      c('approval_status', 'product_master_version_approval_status'),
      c('deleted_at', 'timestamp'),
      c('registration_date', 'timestamp'),
      c('created_at', 'timestamp'),
      c('updated_at', 'timestamp'),
    ],
  },
  {
    name: 'skus',
    conflictColumns: ['id'],
    columns: [
      c('id', 'uuid', false),
      c('group_id', 'uuid'),
      c('option_key', 'varchar'),
      c('name', 'varchar'),
      c('code', 'varchar'),
      c('stock_type', 'stock_type'),
      c('safety_stock', 'integer'),
      c('business_product_name', 'varchar'),
      c('logistics_partner_id', 'uuid'),
      c('discount', 'varchar'),
      c('manufacturer_star', 'varchar'),
      c('product_weight', 'integer'),
      c('dimension_width', 'integer'),
      c('dimension_height', 'integer'),
      c('dimension_depth', 'integer'),
      c('product_material', 'text'),
      c('korean_name', 'varchar'),
      c('max_discount_quantity', 'integer'),
      c('packaging_importer_name', 'varchar'),
      c('product_description', 'text'),
      c('moq', 'integer'),
      c('main_image_url', 'varchar'),
      c('expiry_date_management', 'boolean'),
      c('expiry_start_date', 'timestamptz'),
      c('expiry_end_date', 'timestamptz'),
      c('manufacturing_date_management', 'boolean'),
      c('is_general_inventory', 'boolean'),
      c('validity_start_date', 'timestamptz'),
      c('validity_end_date', 'timestamptz'),
      c('variant_group_code', 'varchar'),
      c('is_deleted', 'boolean'),
      c('deleted_at', 'timestamptz'),
      c('created_at', 'timestamptz'),
      c('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'sku_suppliers',
    conflictColumns: ['sku_id', 'supplier_id'],
    columns: [
      c('sku_id', 'uuid', false),
      c('supplier_id', 'uuid', false),
      c('supplier_sku', 'varchar'),
      c('created_at', 'timestamptz'),
    ],
  },
  {
    name: 'sku_barcodes',
    conflictColumns: ['id'],
    columns: [
      c('id', 'uuid', false),
      c('sku_id', 'uuid'),
      c('barcode', 'varchar'),
      c('is_primary', 'boolean'),
      c('packing_unit', 'integer'),
      c('created_at', 'timestamptz'),
      c('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'sku_images',
    conflictColumns: ['id'],
    columns: [
      c('id', 'uuid', false),
      c('sku_id', 'uuid'),
      c('upload_id', 'uuid'),
      c('is_primary', 'boolean'),
      c('sort_order', 'integer'),
      c('created_at', 'timestamptz'),
    ],
  },
  {
    name: 'sku_categories',
    conflictColumns: ['id'],
    columns: [
      c('id', 'uuid', false),
      c('sku_id', 'uuid'),
      c('category_id', 'uuid'),
      c('created_at', 'timestamptz'),
      c('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'product_master_categories',
    conflictColumns: ['id'],
    columns: [
      c('id', 'uuid', false),
      c('master_id', 'uuid'),
      c('category_id', 'uuid'),
      c('version_id', 'uuid'),
      c('is_primary', 'boolean'),
      c('created_at', 'timestamp'),
    ],
  },
  {
    name: 'product_master_option_groups',
    conflictColumns: ['id'],
    columns: [
      c('id', 'uuid', false),
      c('master_id', 'uuid'),
      c('option_group_id', 'uuid'),
      c('version_id', 'uuid'),
      c('created_at', 'timestamp'),
    ],
  },
  {
    name: 'product_master_variants',
    conflictColumns: ['id'],
    columns: [
      c('id', 'uuid', false),
      c('master_id', 'uuid'),
      c('variant_id', 'uuid'),
      c('version_id', 'uuid'),
      c('created_at', 'timestamp'),
    ],
  },
  {
    name: 'product_option_group_displays',
    conflictColumns: ['id'],
    columns: [
      c('id', 'uuid', false),
      c('option_group_id', 'uuid'),
      c('master_id', 'uuid'),
      c('version_id', 'uuid'),
      c('locale', 'varchar'),
      c('display_name', 'varchar'),
      c('description', 'text'),
      c('sort_order', 'integer'),
      c('created_at', 'timestamp'),
    ],
  },
  {
    name: 'product_option_value_displays',
    conflictColumns: ['id'],
    columns: [
      c('id', 'uuid', false),
      c('option_value_id', 'uuid'),
      c('master_id', 'uuid'),
      c('version_id', 'uuid'),
      c('locale', 'varchar'),
      c('display_name', 'varchar'),
      c('color_code', 'varchar'),
      c('image_url', 'text'),
      c('sort_order', 'integer'),
      c('created_at', 'timestamp'),
    ],
  },
  {
    name: 'variant_option_values',
    conflictColumns: ['id'],
    columns: [c('id', 'uuid', false), c('variant_id', 'uuid'), c('option_value_id', 'uuid')],
  },
  {
    name: 'pricing_rules',
    conflictColumns: ['id'],
    columns: [
      c('id', 'uuid', false),
      c('layer', 'pricing_rule_layer'),
      c('order', 'integer'),
      c('scope_type', 'pricing_rule_scope_type'),
      c('scope_target_ids', 'uuid[]'),
      c('operation_type', 'pricing_rule_operation_type'),
      c('operation_value', 'bigint'),
      c('min_quantity', 'integer'),
      c('created_at', 'timestamp'),
      c('updated_at', 'timestamp'),
    ],
  },
  {
    name: 'product_master_pricing_rules',
    conflictColumns: ['id'],
    columns: [
      c('id', 'uuid', false),
      c('master_id', 'uuid'),
      c('pricing_rule_id', 'uuid'),
      c('version_id', 'uuid'),
      c('created_at', 'timestamp'),
    ],
  },
  {
    name: 'product_variant_price_cache',
    conflictColumns: ['id'],
    columns: [
      c('id', 'uuid', false),
      c('version_id', 'uuid'),
      c('variant_id', 'uuid'),
      c('base_price', 'bigint'),
      c('membership_price', 'bigint'),
      c('tiered_prices', 'jsonb'),
      c('created_at', 'timestamp'),
    ],
  },
  {
    name: 'product_images',
    conflictColumns: ['id'],
    columns: [
      c('id', 'uuid', false),
      c('version_id', 'uuid'),
      c('file_id', 'uuid'),
      c('is_primary', 'boolean'),
      c('sort_order', 'integer'),
      c('created_at', 'timestamp'),
    ],
  },
  {
    name: 'product_purchase_constraints',
    conflictColumns: ['id'],
    columns: [
      c('id', 'uuid', false),
      c('requires_membership', 'boolean'),
      c('lifetime_quantity_limit', 'integer'),
      c('created_at', 'timestamp'),
      c('updated_at', 'timestamp'),
    ],
  },
  {
    name: 'product_master_purchase_constraints',
    conflictColumns: ['id'],
    columns: [
      c('id', 'uuid', false),
      c('master_id', 'uuid'),
      c('version_id', 'uuid'),
      c('purchase_constraint_id', 'uuid'),
      c('created_at', 'timestamp'),
    ],
  },
  {
    name: 'product_matchings',
    conflictColumns: ['id'],
    columns: [
      c('id', 'uuid', false),
      c('variant_id', 'uuid'),
      c('master_id', 'uuid'),
      c('sku_group_id', 'uuid'),
      c('status', 'matching_status'),
      c('priority', 'matching_priority'),
      c('strategy', 'matching_strategy'),
      c('is_resolved', 'boolean'),
      c('pre_stock_sellable', 'boolean'),
      c('always_sellable_zero_stock', 'boolean'),
      c('created_at', 'timestamptz'),
      c('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'product_variant_sku_links',
    conflictColumns: ['product_matching_id', 'sku_id'],
    columns: [
      c('product_matching_id', 'uuid', false),
      c('sku_id', 'uuid', false),
      c('quantity', 'integer'),
      c('created_at', 'timestamptz'),
    ],
  },
] as const;

export type CatalogRow = Record<string, unknown>;

export interface DatabaseIdentity {
  database: string;
  host: string;
  port: number;
}

export interface SnapshotSourceIdentity extends DatabaseIdentity {
  stage: 'live';
  readOnly: true;
}

export interface SnapshotNormalization {
  table: CatalogTableName;
  column: string;
  parentTable: CatalogTableName;
  parentColumn: string;
  reason: 'nullable_orphan_reference';
  count: number;
  references: Array<{ rowId: string; referencedId: string }>;
  rowIds: string[];
  referencedIds: string[];
  sha256: string;
}

export interface CatalogSnapshot {
  manifest: {
    schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
    generatedAt: string;
    source: SnapshotSourceIdentity;
    skuIds: string[];
    skuIdSha256: string;
    counts: Partial<Record<CatalogTableName, number>>;
    normalizations: SnapshotNormalization[];
    contentSha256: string;
  };
  tables: Record<CatalogTableName, CatalogRow[]>;
}

export interface DemoTargetAssertion {
  stage?: string;
  externalIntegrationsMode?: string;
  actual: DatabaseIdentity;
  expected: DatabaseIdentity;
  fixtureRows: number;
}

export function assertDemoTarget(input: DemoTargetAssertion): void {
  if (input.stage !== 'demo') throw new Error(`Target stage must be demo; received ${String(input.stage)}`);
  if (input.externalIntegrationsMode !== 'mock') {
    throw new Error('Target external integrations mode must be mock');
  }
  const exactBinding =
    input.actual.database === input.expected.database &&
    input.actual.host === input.expected.host &&
    input.actual.port === input.expected.port;
  if (!exactBinding) {
    throw new Error(
      `Target binding mismatch (expected ${input.expected.host}:${input.expected.port}/${input.expected.database}, ` +
        `received ${input.actual.host}:${input.actual.port}/${input.actual.database})`,
    );
  }
  if (input.fixtureRows !== 5) {
    throw new Error(`Target demo fixture identity is incomplete (expected 5 markers, received ${input.fixtureRows})`);
  }
}

function uuidFromDigest(value: string): string {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function deterministicCatalogIds(skuId: string): {
  masterId: string;
  versionId: string;
  variantId: string;
  masterVariantId: string;
  matchingId: string;
} {
  const id = (kind: string) => uuidFromDigest(`almondyoung-demo-catalog:v1:${kind}:${skuId}`);
  return {
    masterId: id('master'),
    versionId: id('version'),
    variantId: id('variant'),
    masterVariantId: id('master-variant'),
    matchingId: id('matching'),
  };
}

function stableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

export function sha256Json(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

function dataForContentHash(snapshot: CatalogSnapshot): unknown {
  return {
    schemaVersion: snapshot.manifest.schemaVersion,
    source: snapshot.manifest.source,
    skuIds: snapshot.manifest.skuIds,
    counts: snapshot.manifest.counts,
    normalizations: snapshot.manifest.normalizations,
    tables: snapshot.tables,
  };
}

export function finalizeSnapshot(snapshot: CatalogSnapshot): CatalogSnapshot {
  const skuIds = snapshot.tables.skus.map((row) => String(row.id)).sort();
  const counts = Object.fromEntries(CATALOG_TABLES.map((table) => [table.name, snapshot.tables[table.name].length]));
  snapshot.manifest.skuIds = skuIds;
  snapshot.manifest.counts = counts;
  snapshot.manifest.skuIdSha256 = sha256Json(skuIds);
  snapshot.manifest.contentSha256 = sha256Json(dataForContentHash(snapshot));
  return snapshot;
}

const tableByName = new Map(CATALOG_TABLES.map((table) => [table.name, table]));

interface NullableOrphanPolicy {
  table: CatalogTableName;
  column: string;
  parentTable: CatalogTableName;
  parentColumn?: string;
}

const NULLABLE_ORPHAN_POLICIES: readonly NullableOrphanPolicy[] = [
  { table: 'product_matchings', column: 'master_id', parentTable: 'product_masters' },
  { table: 'product_matchings', column: 'sku_group_id', parentTable: 'sku_groups' },
  { table: 'skus', column: 'group_id', parentTable: 'sku_groups' },
  { table: 'skus', column: 'logistics_partner_id', parentTable: 'suppliers' },
  { table: 'product_categories', column: 'parent_id', parentTable: 'product_categories' },
  {
    table: 'product_master_versions',
    column: 'parent_version_id',
    parentTable: 'product_master_versions',
  },
];

export function normalizeNullableOrphans(tables: CatalogSnapshot['tables']): SnapshotNormalization[] {
  const normalizations: SnapshotNormalization[] = [];
  for (const policy of NULLABLE_ORPHAN_POLICIES) {
    const parentColumn = policy.parentColumn ?? 'id';
    const parents = idSet(tables[policy.parentTable], parentColumn);
    const tablePolicy = getCatalogTablePolicy(policy.table);
    const affected: Array<{ rowId: string; referencedId: string }> = [];
    for (const row of tables[policy.table]) {
      const value = row[policy.column];
      if (value === null || value === undefined) continue;
      if (typeof value !== 'string') throw new Error(`Invalid reference: ${policy.table}.${policy.column}`);
      if (parents.has(value)) continue;
      affected.push({
        rowId: tablePolicy.conflictColumns.map((column) => String(row[column])).join(':'),
        referencedId: value,
      });
      row[policy.column] = null;
    }
    if (!affected.length) continue;
    const references = affected.sort((a, b) => a.rowId.localeCompare(b.rowId));
    const rowIds = references.map((row) => row.rowId);
    const referencedIds = [...new Set(references.map((row) => row.referencedId))].sort();
    normalizations.push({
      table: policy.table,
      column: policy.column,
      parentTable: policy.parentTable,
      parentColumn,
      reason: 'nullable_orphan_reference',
      count: affected.length,
      references,
      rowIds,
      referencedIds,
      sha256: sha256Json(references),
    });
  }
  return normalizations;
}

function idSet(rows: CatalogRow[], column = 'id'): Set<string> {
  return new Set(rows.map((row) => String(row[column])));
}

function assertForeignKey(
  snapshot: CatalogSnapshot,
  childTable: CatalogTableName,
  childColumn: string,
  parentTable: CatalogTableName,
  parentColumn = 'id',
  nullable = false,
): void {
  const parents = idSet(snapshot.tables[parentTable], parentColumn);
  for (const row of snapshot.tables[childTable]) {
    const value = row[childColumn];
    if (nullable && (value === null || value === undefined)) continue;
    if (!parents.has(String(value))) {
      throw new Error(
        `${childTable}.${childColumn} references missing ${parentTable}.${parentColumn}: ${String(value)}`,
      );
    }
  }
}

const RESERVED_IDS = new Set([
  ...DEMO_LOGISTICS_FIXTURE.catalog.flatMap((item) => [
    item.masterId,
    item.versionId,
    item.variantId,
    item.skuId,
    item.matchingId,
  ]),
  ...DEMO_LOGISTICS_FIXTURE.suppliers.map((supplier) => supplier.id),
]);

export function assertSnapshot(snapshot: CatalogSnapshot, options: { verifyHashes?: boolean } = {}): void {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.manifest || !snapshot.tables) {
    throw new Error('Snapshot must contain manifest and tables');
  }
  if (snapshot.manifest.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`Unsupported snapshot schema version: ${String(snapshot.manifest.schemaVersion)}`);
  }
  if (snapshot.manifest.source.stage !== 'live' || snapshot.manifest.source.readOnly !== true) {
    throw new Error('Snapshot source must be a read-only live transaction');
  }
  if (!Number.isFinite(Date.parse(snapshot.manifest.generatedAt))) {
    throw new Error('Snapshot generatedAt must be a valid timestamp');
  }
  if (!Array.isArray(snapshot.manifest.normalizations)) {
    throw new Error('Snapshot manifest normalizations must be an array');
  }
  for (const normalization of snapshot.manifest.normalizations) {
    if (
      normalization.reason !== 'nullable_orphan_reference' ||
      normalization.count !== normalization.rowIds.length ||
      normalization.count !== normalization.references.length ||
      !normalization.sha256 ||
      !Array.isArray(normalization.referencedIds) ||
      normalization.sha256 !== sha256Json(normalization.references)
    ) {
      throw new Error(`Invalid snapshot normalization provenance for ${normalization.table}.${normalization.column}`);
    }
  }

  const tableNames = Object.keys(snapshot.tables);
  const allowedTables = new Set(CATALOG_TABLES.map((table) => table.name));
  for (const name of tableNames) {
    if (!allowedTables.has(name as CatalogTableName)) throw new Error(`Snapshot contains undeclared table: ${name}`);
  }

  for (const table of CATALOG_TABLES) {
    const rows = snapshot.tables[table.name];
    if (!Array.isArray(rows)) throw new Error(`Snapshot is missing table array: ${table.name}`);
    const allowedColumns = new Set(table.columns.map((column) => column.name));
    const seenKeys = new Set<string>();
    for (const row of rows) {
      for (const column of Object.keys(row)) {
        if (!allowedColumns.has(column)) throw new Error(`${table.name} contains undeclared column: ${column}`);
      }
      const key = table.conflictColumns.map((column) => String(row[column])).join('\u0000');
      if (seenKeys.has(key)) throw new Error(`${table.name} contains duplicate key: ${key}`);
      seenKeys.add(key);
      for (const column of table.conflictColumns) {
        if (row[column] === null || row[column] === undefined || row[column] === '') {
          throw new Error(`${table.name}.${column} must be present`);
        }
      }
      for (const value of Object.values(row)) {
        if (typeof value === 'string' && RESERVED_IDS.has(value)) {
          throw new Error(`${table.name} overlaps demo fixture identifier ${value}`);
        }
      }
    }
    const declaredCount = snapshot.manifest.counts[table.name];
    if (declaredCount !== undefined && declaredCount !== rows.length) {
      throw new Error(`${table.name} count mismatch: manifest=${declaredCount}, rows=${rows.length}`);
    }
  }

  const actualSkuIds = snapshot.tables.skus.map((row) => String(row.id)).sort();
  const manifestSkuIds = [...snapshot.manifest.skuIds].sort();
  if (
    new Set(actualSkuIds).size !== actualSkuIds.length ||
    JSON.stringify(actualSkuIds) !== JSON.stringify(manifestSkuIds)
  ) {
    throw new Error('Manifest SKU identifier set does not exactly match skus rows');
  }

  assertForeignKey(snapshot, 'sku_suppliers', 'sku_id', 'skus');
  assertForeignKey(snapshot, 'sku_suppliers', 'supplier_id', 'suppliers');
  assertForeignKey(snapshot, 'supplier_lead_time_profiles', 'supplier_id', 'suppliers');
  assertForeignKey(snapshot, 'replenishment_supplier_rules', 'supplier_id', 'suppliers');
  assertForeignKey(snapshot, 'sku_barcodes', 'sku_id', 'skus');
  assertForeignKey(snapshot, 'sku_images', 'sku_id', 'skus');
  assertForeignKey(snapshot, 'sku_categories', 'sku_id', 'skus');
  assertForeignKey(snapshot, 'sku_categories', 'category_id', 'categories');
  assertForeignKey(snapshot, 'skus', 'group_id', 'sku_groups', 'id', true);
  assertForeignKey(snapshot, 'skus', 'logistics_partner_id', 'suppliers', 'id', true);
  assertForeignKey(snapshot, 'product_categories', 'parent_id', 'product_categories', 'id', true);
  assertForeignKey(snapshot, 'product_option_values', 'option_group_id', 'product_option_groups');
  assertForeignKey(snapshot, 'product_master_versions', 'master_id', 'product_masters');
  assertForeignKey(snapshot, 'product_master_versions', 'parent_version_id', 'product_master_versions', 'id', true);
  assertForeignKey(snapshot, 'product_master_categories', 'master_id', 'product_masters');
  assertForeignKey(snapshot, 'product_master_categories', 'category_id', 'product_categories');
  assertForeignKey(snapshot, 'product_master_categories', 'version_id', 'product_master_versions');
  assertForeignKey(snapshot, 'product_master_option_groups', 'master_id', 'product_masters');
  assertForeignKey(snapshot, 'product_master_option_groups', 'option_group_id', 'product_option_groups');
  assertForeignKey(snapshot, 'product_master_option_groups', 'version_id', 'product_master_versions');
  assertForeignKey(snapshot, 'product_master_variants', 'master_id', 'product_masters');
  assertForeignKey(snapshot, 'product_master_variants', 'variant_id', 'product_variants');
  assertForeignKey(snapshot, 'product_master_variants', 'version_id', 'product_master_versions');
  assertForeignKey(snapshot, 'product_option_group_displays', 'option_group_id', 'product_option_groups');
  assertForeignKey(snapshot, 'product_option_group_displays', 'master_id', 'product_masters');
  assertForeignKey(snapshot, 'product_option_group_displays', 'version_id', 'product_master_versions');
  assertForeignKey(snapshot, 'product_option_value_displays', 'option_value_id', 'product_option_values');
  assertForeignKey(snapshot, 'product_option_value_displays', 'master_id', 'product_masters');
  assertForeignKey(snapshot, 'product_option_value_displays', 'version_id', 'product_master_versions');
  assertForeignKey(snapshot, 'variant_option_values', 'variant_id', 'product_variants');
  assertForeignKey(snapshot, 'variant_option_values', 'option_value_id', 'product_option_values');
  assertForeignKey(snapshot, 'product_master_pricing_rules', 'master_id', 'product_masters');
  assertForeignKey(snapshot, 'product_master_pricing_rules', 'pricing_rule_id', 'pricing_rules');
  assertForeignKey(snapshot, 'product_master_pricing_rules', 'version_id', 'product_master_versions');
  assertForeignKey(snapshot, 'product_variant_price_cache', 'version_id', 'product_master_versions');
  assertForeignKey(snapshot, 'product_variant_price_cache', 'variant_id', 'product_variants');
  assertForeignKey(snapshot, 'product_images', 'version_id', 'product_master_versions');
  assertForeignKey(snapshot, 'product_master_purchase_constraints', 'master_id', 'product_masters');
  assertForeignKey(snapshot, 'product_master_purchase_constraints', 'version_id', 'product_master_versions');
  assertForeignKey(
    snapshot,
    'product_master_purchase_constraints',
    'purchase_constraint_id',
    'product_purchase_constraints',
  );
  assertForeignKey(snapshot, 'product_matchings', 'variant_id', 'product_variants');
  assertForeignKey(snapshot, 'product_matchings', 'master_id', 'product_masters', 'id', true);
  assertForeignKey(snapshot, 'product_matchings', 'sku_group_id', 'sku_groups', 'id', true);
  assertForeignKey(snapshot, 'product_variant_sku_links', 'product_matching_id', 'product_matchings');
  assertForeignKey(snapshot, 'product_variant_sku_links', 'sku_id', 'skus');

  const barcodes = snapshot.tables.sku_barcodes.map((row) => String(row.barcode));
  if (new Set(barcodes).size !== barcodes.length) throw new Error('sku_barcodes contains duplicate barcode values');

  if (options.verifyHashes !== false) {
    if (snapshot.manifest.skuIdSha256 !== sha256Json(actualSkuIds)) throw new Error('SKU identifier hash mismatch');
    if (snapshot.manifest.contentSha256 !== sha256Json(dataForContentHash(snapshot))) {
      throw new Error('Snapshot content hash mismatch');
    }
  }
}

export function emptyCatalogTables(): CatalogSnapshot['tables'] {
  return Object.fromEntries(CATALOG_TABLES.map((table) => [table.name, []])) as unknown as CatalogSnapshot['tables'];
}

export function getCatalogTablePolicy(name: CatalogTableName): CatalogTablePolicy {
  const table = tableByName.get(name);
  if (!table) throw new Error(`Unknown catalog table policy: ${name}`);
  return table;
}
