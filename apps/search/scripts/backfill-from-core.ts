#!/usr/bin/env ts-node

import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Client } from '@opensearch-project/opensearch';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  catalogSchema as pimSchema,
  productCategories,
  productImages,
  productMasterCategories,
  productMasters,
  productMasterVersions,
  productTagValues,
  productVariantPriceCache,
  tagValues,
} from '../../core/src/modules/catalog/schema/catalog.schema';
import {
  DEFAULT_PRODUCTS_INDEX,
  PRODUCTS_INDEX_MAPPINGS,
  PRODUCTS_INDEX_SETTINGS,
  SearchProductDocument,
} from '../src/types/product-document.type';

type BackfillOptions = {
  batchSize: number;
  offset: number;
  limit?: number;
  masters?: string[];
  recreateIndex: boolean;
  dryRun: boolean;
};

type ActiveVersionRow = {
  masterId: string;
  versionId: string;
  name: string;
  description: string | null;
  brand: string | null;
  status: 'draft' | 'inactive' | 'active';
  updatedAt: Date;
};

type CategoryMapValue = {
  ids: string[];
  names: string[];
};

type PriceSummary = {
  minBasePrice: number | null;
  maxBasePrice: number | null;
  minMembershipPrice: number | null;
  maxMembershipPrice: number | null;
};

type PimDb = ReturnType<typeof drizzle>;

function parseArgs(): BackfillOptions {
  const args = process.argv.slice(2);

  const getOptionValue = (name: string): string | undefined => {
    const found = args.find((arg) => arg.startsWith(`${name}=`));
    return found ? found.substring(name.length + 1) : undefined;
  };

  const parsePositiveInt = (rawValue: string | undefined, name: string, defaultValue: number): number => {
    if (rawValue === undefined) {
      return defaultValue;
    }

    const parsed = Number(rawValue);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`${name} must be a non-negative integer`);
    }
    return parsed;
  };

  const batchSize = parsePositiveInt(getOptionValue('--batch-size'), '--batch-size', 300);
  if (batchSize < 1) {
    throw new Error('--batch-size must be >= 1');
  }

  const offset = parsePositiveInt(getOptionValue('--offset'), '--offset', 0);
  const limitRaw = getOptionValue('--limit');
  const limit = limitRaw === undefined ? undefined : parsePositiveInt(limitRaw, '--limit', 0);

  const mastersRaw = getOptionValue('--masters');
  const masters = mastersRaw
    ? mastersRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  return {
    batchSize,
    offset,
    limit: limit === undefined ? undefined : Math.max(limit, 0),
    masters,
    recreateIndex: args.includes('--recreate-index'),
    dryRun: args.includes('--dry-run'),
  };
}

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  npx ts-node -r tsconfig-paths/register apps/search/scripts/backfill-from-pim.ts [options]',
      '',
      'Options:',
      '  --batch-size=300      Number of products per batch (default: 300)',
      '  --offset=0            Start offset (default: 0)',
      '  --limit=1000          Max number of products to process',
      '  --masters=id1,id2     Comma-separated PIM master IDs to index (skips --offset/--limit)',
      '  --recreate-index      Delete and recreate target index before backfill',
      '  --dry-run             Read and transform only, skip OpenSearch writes',
      '',
      'Required env:',
      '  PIM_SOURCE_DB_URL',
      '',
      'Optional env:',
      '  OPENSEARCH_NODE | ELASTICSEARCH_NODE',
      '  OPENSEARCH_USERNAME | ELASTICSEARCH_USERNAME',
      '  OPENSEARCH_PASSWORD | ELASTICSEARCH_PASSWORD',
      '  SEARCH_PRODUCTS_INDEX',
      '  FILE_SERVICE_URL',
    ].join('\n'),
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeBaseUrl(value: string): string {
  if (!value) {
    return '';
  }
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function toThumbnailUrl(fileIdOrUrl: string | null, fileServiceUrl: string): string | null {
  if (!fileIdOrUrl) {
    return null;
  }

  if (fileIdOrUrl.startsWith('http://') || fileIdOrUrl.startsWith('https://')) {
    return fileIdOrUrl;
  }

  if (fileIdOrUrl.startsWith('/files/')) {
    return fileServiceUrl ? `${fileServiceUrl}${fileIdOrUrl}` : fileIdOrUrl;
  }

  return fileServiceUrl ? `${fileServiceUrl}/files/${fileIdOrUrl}` : `/files/${fileIdOrUrl}`;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, '');
}

async function ensureIndex(client: Client, index: string, recreateIndex: boolean): Promise<void> {
  const exists = (await client.indices.exists({ index })).body;

  if (exists && recreateIndex) {
    console.log(`Deleting existing index: ${index}`);
    await client.indices.delete({ index });
  }

  if (!exists || recreateIndex) {
    console.log(`Creating index: ${index}`);
    await client.indices.create({
      index,
      body: {
        settings: PRODUCTS_INDEX_SETTINGS,
        mappings: PRODUCTS_INDEX_MAPPINGS,
      },
    });
  }
}

async function fetchActiveVersionCount(db: PimDb, masterIds?: string[]) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int4` })
    .from(productMasterVersions)
    .innerJoin(productMasters, eq(productMasterVersions.masterId, productMasters.id))
    .where(
      and(
        eq(productMasterVersions.status, 'active'),
        isNull(productMasterVersions.deletedAt),
        isNull(productMasters.deletedAt),
        masterIds && masterIds.length > 0 ? inArray(productMasterVersions.masterId, masterIds) : undefined,
      ),
    );

  return row?.count ?? 0;
}

async function fetchActiveVersionsBatch(
  db: PimDb,
  batchSize: number,
  offset: number,
  masterIds?: string[],
): Promise<ActiveVersionRow[]> {
  return db
    .select({
      masterId: productMasterVersions.masterId,
      versionId: productMasterVersions.id,
      name: productMasterVersions.name,
      description: productMasterVersions.description,
      brand: productMasterVersions.brand,
      status: productMasterVersions.status,
      updatedAt: productMasterVersions.updatedAt,
    })
    .from(productMasterVersions)
    .innerJoin(productMasters, eq(productMasterVersions.masterId, productMasters.id))
    .where(
      and(
        eq(productMasterVersions.status, 'active'),
        isNull(productMasterVersions.deletedAt),
        isNull(productMasters.deletedAt),
        masterIds && masterIds.length > 0 ? inArray(productMasterVersions.masterId, masterIds) : undefined,
      ),
    )
    .orderBy(asc(productMasterVersions.updatedAt), asc(productMasterVersions.id))
    .limit(batchSize)
    .offset(offset);
}

async function fetchCategoryMap(db: PimDb, versionIds: string[]): Promise<Map<string, CategoryMapValue>> {
  if (versionIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      versionId: productMasterCategories.versionId,
      categoryId: productMasterCategories.categoryId,
      categoryName: productCategories.name,
    })
    .from(productMasterCategories)
    .leftJoin(productCategories, eq(productMasterCategories.categoryId, productCategories.id))
    .where(inArray(productMasterCategories.versionId, versionIds));

  const map = new Map<string, { ids: Set<string>; names: Set<string> }>();

  for (const row of rows) {
    const entry = map.get(row.versionId) ?? {
      ids: new Set<string>(),
      names: new Set<string>(),
    };
    entry.ids.add(row.categoryId);
    if (row.categoryName) {
      entry.names.add(row.categoryName);
    }
    map.set(row.versionId, entry);
  }

  const result = new Map<string, CategoryMapValue>();
  for (const [versionId, value] of map.entries()) {
    result.set(versionId, {
      ids: Array.from(value.ids),
      names: Array.from(value.names),
    });
  }

  return result;
}

async function fetchTagMap(db: PimDb, versionIds: string[]): Promise<Map<string, string[]>> {
  if (versionIds.length === 0) {
    return new Map();
  }

  let rows: { versionId: string; tagName: string }[];
  try {
    rows = await db
      .select({
        versionId: productTagValues.versionId,
        tagName: tagValues.name,
      })
      .from(productTagValues)
      .innerJoin(tagValues, eq(productTagValues.tagValueId, tagValues.id))
      .where(inArray(productTagValues.versionId, versionIds));
  } catch (err: any) {
    console.warn(`  [warn] fetchTagMap failed (tags skipped): ${err?.message ?? err}`);
    return new Map();
  }

  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = map.get(row.versionId) ?? new Set<string>();
    set.add(row.tagName);
    map.set(row.versionId, set);
  }

  const result = new Map<string, string[]>();
  for (const [versionId, set] of map.entries()) {
    result.set(versionId, Array.from(set));
  }
  return result;
}

async function fetchPrimaryImageMap(db: PimDb, versionIds: string[]): Promise<Map<string, string>> {
  if (versionIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      versionId: productImages.versionId,
      fileId: productImages.fileId,
    })
    .from(productImages)
    .where(and(inArray(productImages.versionId, versionIds), eq(productImages.isPrimary, true)));

  return new Map(rows.map((row) => [row.versionId, row.fileId]));
}

async function fetchPriceMap(db: PimDb, versionIds: string[]): Promise<Map<string, PriceSummary>> {
  if (versionIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      versionId: productVariantPriceCache.versionId,
      minBasePrice: sql<number>`min(${productVariantPriceCache.basePrice})::float8`,
      maxBasePrice: sql<number>`max(${productVariantPriceCache.basePrice})::float8`,
      minMembershipPrice: sql<number>`min(${productVariantPriceCache.membershipPrice})::float8`,
      maxMembershipPrice: sql<number>`max(${productVariantPriceCache.membershipPrice})::float8`,
    })
    .from(productVariantPriceCache)
    .where(inArray(productVariantPriceCache.versionId, versionIds))
    .groupBy(productVariantPriceCache.versionId);

  const map = new Map<string, PriceSummary>();
  for (const row of rows) {
    map.set(row.versionId, {
      minBasePrice: row.minBasePrice === null ? null : Number(row.minBasePrice),
      maxBasePrice: row.maxBasePrice === null ? null : Number(row.maxBasePrice),
      minMembershipPrice: row.minMembershipPrice === null ? null : Number(row.minMembershipPrice),
      maxMembershipPrice: row.maxMembershipPrice === null ? null : Number(row.maxMembershipPrice),
    });
  }

  return map;
}

function buildDocuments(
  activeVersions: ActiveVersionRow[],
  categoryMap: Map<string, CategoryMapValue>,
  tagMap: Map<string, string[]>,
  priceMap: Map<string, PriceSummary>,
  primaryImageMap: Map<string, string>,
  fileServiceUrl: string,
): SearchProductDocument[] {
  return activeVersions.map((row) => {
    const categories = categoryMap.get(row.versionId);
    const tags = tagMap.get(row.versionId) ?? [];
    const prices = priceMap.get(row.versionId);
    const primaryFileId = primaryImageMap.get(row.versionId) ?? null;
    const updatedAtIso = row.updatedAt.toISOString();

    return {
      master_id: row.masterId,
      version_id: row.versionId,
      name: row.name,
      name_compact: compactText(row.name),
      description: row.description ?? null,
      thumbnail: toThumbnailUrl(primaryFileId, fileServiceUrl),
      brand: row.brand ?? null,
      category_ids: categories?.ids ?? [],
      category_names: categories?.names ?? [],
      tags,
      min_base_price: prices?.minBasePrice ?? null,
      max_base_price: prices?.maxBasePrice ?? null,
      min_membership_price: prices?.minMembershipPrice ?? null,
      max_membership_price: prices?.maxMembershipPrice ?? null,
      status: row.status,
      changed_at: updatedAtIso,
      updated_at: updatedAtIso,
    };
  });
}

async function bulkUpsert(
  client: Client,
  index: string,
  documents: SearchProductDocument[],
): Promise<{ success: number; failed: number }> {
  if (documents.length === 0) {
    return { success: 0, failed: 0 };
  }

  // Use update + doc_as_upsert instead of index so that review fields already in the
  // document (populated by the review stats backfill or Kafka consumer) are preserved
  // when the product backfill is re-run.
  const operations: any[] = [];
  for (const doc of documents) {
    operations.push({
      update: {
        _index: index,
        _id: doc.master_id,
      },
    });
    operations.push({ doc, doc_as_upsert: true });
  }

  const response: any = await client.bulk({
    refresh: false,
    body: operations,
  });

  if (!response.body.errors) {
    return { success: documents.length, failed: 0 };
  }

  let failed = 0;
  for (let i = 0; i < response.body.items.length; i++) {
    const item = response.body.items[i]?.update;
    if (item?.error) {
      failed += 1;
      const id = documents[i]?.master_id;
      const reason = item.error.reason || JSON.stringify(item.error);
      console.error(`  FAILED bulk item (${id}): ${reason}`);
    }
  }

  return { success: documents.length - failed, failed };
}

async function main() {
  if (process.argv.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const options = parseArgs();
  const pimSourceDbUrl = requireEnv('PIM_SOURCE_DB_URL');
  const opensearchNode = process.env.OPENSEARCH_NODE || process.env.ELASTICSEARCH_NODE || 'http://localhost:9200';
  const opensearchUsername = process.env.OPENSEARCH_USERNAME || process.env.ELASTICSEARCH_USERNAME;
  const opensearchPassword = process.env.OPENSEARCH_PASSWORD || process.env.ELASTICSEARCH_PASSWORD;
  const productsIndex = process.env.SEARCH_PRODUCTS_INDEX || DEFAULT_PRODUCTS_INDEX;
  const fileServiceUrl = normalizeBaseUrl(process.env.FILE_SERVICE_URL || '');

  console.log('Search backfill started');
  console.log(`- Batch size: ${options.batchSize}`);
  console.log(`- Offset: ${options.offset}`);
  if (options.limit !== undefined) {
    console.log(`- Limit: ${options.limit}`);
  }
  console.log(`- Dry run: ${options.dryRun ? 'yes' : 'no'}`);
  console.log(`- Recreate index: ${options.recreateIndex ? 'yes' : 'no'}`);
  console.log(`- OpenSearch index: ${productsIndex}`);
  console.log();

  const pimSql = postgres(pimSourceDbUrl, {
    max: 8,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  const pimDb = drizzle(pimSql, { schema: pimSchema });

  const osClient = new Client({
    node: opensearchNode,
    auth:
      opensearchUsername && opensearchPassword
        ? { username: opensearchUsername, password: opensearchPassword }
        : undefined,
  });

  let processed = 0;
  let success = 0;
  let failed = 0;
  let offset = options.offset;
  const startedAt = Date.now();

  try {
    const sourceCount = await fetchActiveVersionCount(pimDb, options.masters);
    const targetCount =
      options.limit === undefined
        ? Math.max(sourceCount - options.offset, 0)
        : Math.min(Math.max(sourceCount - options.offset, 0), options.limit);

    if (options.masters) {
      console.log(`Filtering to masters: ${options.masters.join(', ')}`);
    }
    console.log(`Source active versions: ${sourceCount}`);
    console.log(`Planned to process: ${targetCount}`);

    if (!options.dryRun) {
      await ensureIndex(osClient, productsIndex, options.recreateIndex);
    } else {
      console.log('Dry run mode: skipping index create/delete operations');
    }

    while (true) {
      if (options.limit !== undefined && processed >= options.limit) {
        break;
      }

      const remaining =
        options.limit === undefined ? options.batchSize : Math.min(options.batchSize, options.limit - processed);

      if (remaining <= 0) {
        break;
      }

      const batch = await fetchActiveVersionsBatch(pimDb, remaining, offset, options.masters);
      if (batch.length === 0) {
        break;
      }

      const versionIds = batch.map((row) => row.versionId);
      const [categoryMap, tagMap, priceMap, primaryImageMap] = await Promise.all([
        fetchCategoryMap(pimDb, versionIds),
        fetchTagMap(pimDb, versionIds),
        fetchPriceMap(pimDb, versionIds),
        fetchPrimaryImageMap(pimDb, versionIds),
      ]);

      const documents = buildDocuments(batch, categoryMap, tagMap, priceMap, primaryImageMap, fileServiceUrl);

      if (options.dryRun) {
        success += documents.length;
      } else {
        const bulkResult = await bulkUpsert(osClient, productsIndex, documents);
        success += bulkResult.success;
        failed += bulkResult.failed;
      }

      processed += batch.length;
      offset += batch.length;

      console.log(`Batch done: processed=${processed}, success=${success}, failed=${failed}`);
    }

    if (!options.dryRun) {
      await osClient.indices.refresh({ index: productsIndex });
      const countResponse = await osClient.count({ index: productsIndex });
      console.log(`Indexed documents now: ${countResponse.body.count}`);
    } else {
      console.log('Dry run complete (no documents written)');
    }

    const durationSec = Math.floor((Date.now() - startedAt) / 1000);
    console.log();
    console.log('Backfill complete');
    console.log(`- Processed: ${processed}`);
    console.log(`- Success: ${success}`);
    console.log(`- Failed: ${failed}`);
    console.log(`- Duration: ${durationSec}s`);
  } finally {
    await pimSql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error('Backfill failed:', error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
