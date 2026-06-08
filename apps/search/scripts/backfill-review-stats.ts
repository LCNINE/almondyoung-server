#!/usr/bin/env ts-node

/**
 * Backfill review stats into OpenSearch product documents.
 *
 * Reads aggregated review stats directly from the ugc-service DB and partial-updates
 * existing search_products documents. Documents not found in the index are skipped
 * (warn + skip — no zombie upsert). Bayesian score is computed here using the same
 * formula as ugc-service's aggregateReviewStats.
 *
 * Prerequisites:
 *   - search service and ugc-service are deployed
 *   - OpenSearch index exists (run product backfill first)
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register apps/search/scripts/backfill-review-stats.ts [options]
 *
 * Options:
 *   --batch-size=100        Products per batch (default: 100)
 *   --offset=0              Skip first N products (default: 0)
 *   --limit=500             Max products to process
 *   --products=id1,id2      Comma-separated product UUIDs (skips --offset/--limit)
 *   --prior-count=10        Bayesian prior count m (default: 10)
 *   --fallback-prior-mean=3.5  Used only when the UGC DB has no active reviews
 *   --dry-run               Print stats without writing to OpenSearch
 *
 * Required env:
 *   UGC_SOURCE_DB_URL
 *
 * Optional env:
 *   OPENSEARCH_NODE | ELASTICSEARCH_NODE
 *   OPENSEARCH_USERNAME | ELASTICSEARCH_USERNAME
 *   OPENSEARCH_PASSWORD | ELASTICSEARCH_PASSWORD
 *   SEARCH_PRODUCTS_INDEX
 */

import * as postgres from 'postgres';
import { Client } from '@opensearch-project/opensearch';
import { DEFAULT_PRODUCTS_INDEX } from '../src/types/product-document.type';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BackfillOptions = {
  batchSize: number;
  offset: number;
  limit?: number;
  products?: string[];
  priorCount: number;
  fallbackPriorMean: number;
  dryRun: boolean;
};

type ReviewStatsRow = {
  productId: string;
  reviewCount: number;
  ratingSum: number;
  dist1: number;
  dist2: number;
  dist3: number;
  dist4: number;
  dist5: number;
};

type BulkResult = {
  success: number;
  skipped: number;
  failed: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArgs(): BackfillOptions {
  const args = process.argv.slice(2);

  const getOptionValue = (name: string): string | undefined => {
    const found = args.find((a) => a.startsWith(`${name}=`));
    return found ? found.substring(name.length + 1) : undefined;
  };

  const parsePositiveInt = (raw: string | undefined, name: string, def: number): number => {
    if (raw === undefined) return def;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
    return parsed;
  };

  const parsePositiveFloat = (raw: string | undefined, name: string, def: number): number => {
    if (raw === undefined) return def;
    const parsed = Number(raw);
    if (isNaN(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
    return parsed;
  };

  const parseRatingMean = (raw: string | undefined, name: string, def: number): number => {
    if (raw === undefined) return def;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5) {
      throw new Error(`${name} must be a number between 0 and 5`);
    }
    return parsed;
  };

  const batchSize = parsePositiveInt(getOptionValue('--batch-size'), '--batch-size', 100);
  if (batchSize < 1) throw new Error('--batch-size must be >= 1');

  const offset = parsePositiveInt(getOptionValue('--offset'), '--offset', 0);
  const limitRaw = getOptionValue('--limit');
  const limit = limitRaw === undefined ? undefined : parsePositiveInt(limitRaw, '--limit', 0);

  const productsRaw = getOptionValue('--products');
  const products = productsRaw
    ? productsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const legacyConfidence = getOptionValue('--confidence');
  const priorCount = parsePositiveFloat(
    getOptionValue('--prior-count') ?? legacyConfidence,
    legacyConfidence ? '--confidence' : '--prior-count',
    10,
  );
  const fallbackPriorMean = parseRatingMean(
    getOptionValue('--fallback-prior-mean') ?? getOptionValue('--prior-mean'),
    getOptionValue('--prior-mean') ? '--prior-mean' : '--fallback-prior-mean',
    3.5,
  );

  return {
    batchSize,
    offset,
    limit: limit === undefined ? undefined : Math.max(limit, 0),
    products,
    priorCount,
    fallbackPriorMean,
    dryRun: args.includes('--dry-run'),
  };
}

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  npx ts-node -r tsconfig-paths/register apps/search/scripts/backfill-review-stats.ts [options]',
      '',
      'Options:',
      '  --batch-size=100      Products per batch (default: 100)',
      '  --offset=0            Skip first N products (default: 0)',
      '  --limit=500           Max products to process',
      '  --products=id1,id2    Specific product UUIDs (overrides --offset/--limit)',
      '  --prior-count=10      Bayesian prior count m (default: 10)',
      '  --fallback-prior-mean=3.5  Used only when the UGC DB has no active reviews',
      '  --dry-run             Read and compute only, skip OpenSearch writes',
      '',
      'Required env:',
      '  UGC_SOURCE_DB_URL',
      '',
      'Optional env:',
      '  OPENSEARCH_NODE | ELASTICSEARCH_NODE (default: http://localhost:9200)',
      '  OPENSEARCH_USERNAME | ELASTICSEARCH_USERNAME',
      '  OPENSEARCH_PASSWORD | ELASTICSEARCH_PASSWORD',
      '  SEARCH_PRODUCTS_INDEX (default: search_products)',
    ].join('\n'),
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// Bayesian average: (v / (v + m)) * R + (m / (v + m)) * C
// R: product average, v: product review count, C: global active-review average, m: prior count.
function bayesianScore(n: number, ratingSum: number, priorCount: number, globalAverageRating: number): number {
  if (n <= 0) {
    return parseFloat(globalAverageRating.toFixed(3));
  }

  const avg = ratingSum / n;
  const denominator = n + priorCount;
  const score = denominator > 0 ? (n * avg + priorCount * globalAverageRating) / denominator : globalAverageRating;
  return parseFloat(score.toFixed(3));
}

// ---------------------------------------------------------------------------
// DB queries (raw postgres.js — no Drizzle needed for a standalone script)
// ---------------------------------------------------------------------------

async function fetchProductCount(sql: postgres.Sql, productIds?: string[]): Promise<number> {
  if (productIds && productIds.length > 0) {
    const [row] = await sql<[{ count: number }]>`
      SELECT COUNT(DISTINCT product_id)::int4 AS count
      FROM reviews
      WHERE status = 'active'
        AND deleted_at IS NULL
        AND product_id = ANY(${sql.array(productIds)}::uuid[])
    `;
    return row?.count ?? 0;
  }

  const [row] = await sql<[{ count: number }]>`
    SELECT COUNT(DISTINCT product_id)::int4 AS count
    FROM reviews
    WHERE status = 'active'
      AND deleted_at IS NULL
  `;
  return row?.count ?? 0;
}

async function fetchGlobalAverageRating(sql: postgres.Sql, fallbackPriorMean: number): Promise<number> {
  const [row] = await sql<[{ review_count: string; rating_sum: string }]>`
    SELECT
      COUNT(*)::text AS review_count,
      COALESCE(SUM(rating), 0)::text AS rating_sum
    FROM reviews
    WHERE status = 'active'
      AND deleted_at IS NULL
  `;

  const reviewCount = parseInt(row?.review_count ?? '0', 10);
  const ratingSum = parseInt(row?.rating_sum ?? '0', 10);
  return reviewCount > 0 ? ratingSum / reviewCount : fallbackPriorMean;
}

async function fetchStatsBatch(
  sql: postgres.Sql,
  batchSize: number,
  offset: number,
  productIds?: string[],
): Promise<ReviewStatsRow[]> {
  type Row = {
    product_id: string;
    review_count: string;
    rating_sum: string;
    dist_1: string;
    dist_2: string;
    dist_3: string;
    dist_4: string;
    dist_5: string;
  };

  let rows: Row[];

  if (productIds && productIds.length > 0) {
    rows = await sql<Row[]>`
      SELECT
        product_id,
        COUNT(*)::text                                      AS review_count,
        COALESCE(SUM(rating), 0)::text                     AS rating_sum,
        COALESCE(SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END), 0)::text AS dist_1,
        COALESCE(SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END), 0)::text AS dist_2,
        COALESCE(SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END), 0)::text AS dist_3,
        COALESCE(SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END), 0)::text AS dist_4,
        COALESCE(SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END), 0)::text AS dist_5
      FROM reviews
      WHERE status = 'active'
        AND deleted_at IS NULL
        AND product_id = ANY(${sql.array(productIds)}::uuid[])
      GROUP BY product_id
      ORDER BY product_id
      LIMIT ${batchSize} OFFSET ${offset}
    `;
  } else {
    rows = await sql<Row[]>`
      SELECT
        product_id,
        COUNT(*)::text                                      AS review_count,
        COALESCE(SUM(rating), 0)::text                     AS rating_sum,
        COALESCE(SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END), 0)::text AS dist_1,
        COALESCE(SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END), 0)::text AS dist_2,
        COALESCE(SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END), 0)::text AS dist_3,
        COALESCE(SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END), 0)::text AS dist_4,
        COALESCE(SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END), 0)::text AS dist_5
      FROM reviews
      WHERE status = 'active'
        AND deleted_at IS NULL
      GROUP BY product_id
      ORDER BY product_id
      LIMIT ${batchSize} OFFSET ${offset}
    `;
  }

  return rows.map((row) => ({
    productId: row.product_id,
    reviewCount: parseInt(row.review_count, 10),
    ratingSum: parseInt(row.rating_sum, 10),
    dist1: parseInt(row.dist_1, 10),
    dist2: parseInt(row.dist_2, 10),
    dist3: parseInt(row.dist_3, 10),
    dist4: parseInt(row.dist_4, 10),
    dist5: parseInt(row.dist_5, 10),
  }));
}

// ---------------------------------------------------------------------------
// OpenSearch bulk update
// ---------------------------------------------------------------------------

async function bulkUpdateReviewStats(
  client: Client,
  index: string,
  rows: ReviewStatsRow[],
  priorCount: number,
  globalAverageRating: number,
): Promise<BulkResult> {
  if (rows.length === 0) {
    return { success: 0, skipped: 0, failed: 0 };
  }

  const now = new Date().toISOString();
  const operations: any[] = [];

  for (const row of rows) {
    const n = row.reviewCount;
    const avg = n === 0 ? 0 : parseFloat((row.ratingSum / n).toFixed(1));

    operations.push({ update: { _index: index, _id: row.productId } });
    operations.push({
      doc: {
        review_count: n,
        average_rating: avg,
        bayesian_review_score: bayesianScore(n, row.ratingSum, priorCount, globalAverageRating),
        review_stats_updated_at: now,
      },
    });
  }

  const response: any = await client.bulk({ refresh: false, body: operations });

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < response.body.items.length; i++) {
    const item = response.body.items[i]?.update;
    if (!item) continue;

    if (item.status === 404) {
      // Document not in index — product not indexed yet, skip silently at warn level
      skipped += 1;
      const productId = rows[i]?.productId;
      console.warn(`  [skip] product ${productId} not in index (not yet indexed)`);
    } else if (item.error) {
      failed += 1;
      const productId = rows[i]?.productId;
      const reason = item.error.reason ?? JSON.stringify(item.error);
      console.error(`  [fail] product ${productId}: ${reason}`);
    } else {
      success += 1;
    }
  }

  return { success, skipped, failed };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const options = parseArgs();
  const ugcDbUrl = requireEnv('UGC_SOURCE_DB_URL');
  const opensearchNode = process.env.OPENSEARCH_NODE ?? process.env.ELASTICSEARCH_NODE ?? 'http://localhost:9200';
  const opensearchUsername = process.env.OPENSEARCH_USERNAME ?? process.env.ELASTICSEARCH_USERNAME;
  const opensearchPassword = process.env.OPENSEARCH_PASSWORD ?? process.env.ELASTICSEARCH_PASSWORD;
  const productsIndex = process.env.SEARCH_PRODUCTS_INDEX ?? DEFAULT_PRODUCTS_INDEX;

  console.log('Review stats backfill started');
  console.log(`- Batch size   : ${options.batchSize}`);
  console.log(`- Offset       : ${options.offset}`);
  if (options.limit !== undefined) console.log(`- Limit        : ${options.limit}`);
  if (options.products) console.log(`- Products     : ${options.products.join(', ')}`);
  console.log(`- Prior count  : ${options.priorCount}`);
  console.log(`- Fallback mean: ${options.fallbackPriorMean}`);
  console.log(`- Dry run      : ${options.dryRun ? 'yes' : 'no'}`);
  console.log(`- OpenSearch   : ${opensearchNode} / ${productsIndex}`);
  console.log();

  const pgSql = (postgres as any)(ugcDbUrl, {
    max: 4,
    idle_timeout: 20,
    connect_timeout: 10,
  }) as postgres.Sql;

  const osClient = new Client({
    node: opensearchNode,
    auth:
      opensearchUsername && opensearchPassword
        ? { username: opensearchUsername, password: opensearchPassword }
        : undefined,
  });

  let processed = 0;
  let totalSuccess = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let offset = options.offset;
  const startedAt = Date.now();

  try {
    const [sourceCount, globalAverageRating] = await Promise.all([
      fetchProductCount(pgSql, options.products),
      fetchGlobalAverageRating(pgSql, options.fallbackPriorMean),
    ]);
    const plannedCount =
      options.limit === undefined
        ? Math.max(sourceCount - options.offset, 0)
        : Math.min(Math.max(sourceCount - options.offset, 0), options.limit);

    console.log(`Products with active reviews: ${sourceCount}`);
    console.log(`Global active review average: ${globalAverageRating.toFixed(3)}`);
    console.log(`Planned to process          : ${plannedCount}`);
    console.log();

    while (true) {
      if (options.limit !== undefined && processed >= options.limit) break;

      const remaining =
        options.limit === undefined ? options.batchSize : Math.min(options.batchSize, options.limit - processed);
      if (remaining <= 0) break;

      const batch = await fetchStatsBatch(pgSql, remaining, offset, options.products);
      if (batch.length === 0) break;

      if (options.dryRun) {
        for (const row of batch) {
          const n = row.reviewCount;
          const avg = n === 0 ? 0 : parseFloat((row.ratingSum / n).toFixed(1));
          const score = bayesianScore(n, row.ratingSum, options.priorCount, globalAverageRating);
          console.log(`  [dry-run] ${row.productId}: count=${n}, avg=${avg}, bayesian=${score}`);
        }
        totalSuccess += batch.length;
      } else {
        const result = await bulkUpdateReviewStats(
          osClient,
          productsIndex,
          batch,
          options.priorCount,
          globalAverageRating,
        );
        totalSuccess += result.success;
        totalSkipped += result.skipped;
        totalFailed += result.failed;
      }

      processed += batch.length;
      offset += batch.length;

      const pct = plannedCount > 0 ? Math.round((processed / plannedCount) * 100) : 0;
      console.log(
        `Batch done: processed=${processed}/${plannedCount} (${pct}%), success=${totalSuccess}, skipped=${totalSkipped}, failed=${totalFailed}`,
      );
    }

    if (!options.dryRun) {
      await osClient.indices.refresh({ index: productsIndex });
    }

    const durationSec = Math.floor((Date.now() - startedAt) / 1000);
    console.log();
    console.log('Backfill complete');
    console.log(`- Processed  : ${processed}`);
    console.log(`- Success    : ${totalSuccess}`);
    console.log(`- Skipped    : ${totalSkipped}  (product not in index)`);
    console.log(`- Failed     : ${totalFailed}`);
    console.log(`- Duration   : ${durationSec}s`);

    if (totalSkipped > 0) {
      console.log();
      console.log(
        `[WARN] ${totalSkipped} product(s) had reviews in UGC DB but no document in OpenSearch index.`,
      );
      console.log('       Run product backfill first, then re-run this script for those products.');
    }

    if (totalFailed > 0) {
      process.exit(1);
    }
  } finally {
    await pgSql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error('Backfill failed:', error.message);
  if (error.stack) console.error(error.stack);
  process.exit(1);
});
