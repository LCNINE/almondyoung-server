import postgres from 'postgres';

export interface MissingVariant {
  variant_id: string;
  creation_week: string;
  variant_status: string;
  version_statuses: string[];
  master_ids: string[];
  active_master_ids: string[];
  has_live_master: boolean;
  has_live_version: boolean;
  waiting_orders: number;
}

export function backfillPartition(row: MissingVariant): string {
  if (row.master_ids.length !== 1) return 'ambiguous_master';
  if (!row.has_live_master) return 'deleted_master';
  if (!row.has_live_version) return 'deleted_versions';
  if (row.active_master_ids.length !== 1) return 'no_active_version';
  if (row.variant_status !== 'active') return 'variant_inactive';

  return 'eligible';
}

export function backfillApplyMode(args: string[], dryRun: string | undefined): boolean {
  if (args.some((arg) => arg !== '--apply')) throw new Error('Only --apply is supported.');
  if (dryRun !== undefined && dryRun !== '0' && dryRun !== '1') throw new Error('DRY_RUN must be 0 or 1.');
  if (args.includes('--apply') && dryRun === '1') throw new Error('Remove DRY_RUN=1 to use --apply.');
  if (!args.includes('--apply') && dryRun === '0') throw new Error('DRY_RUN=0 requires --apply.');

  return args.includes('--apply');
}

function findMissingVariants(sql: postgres.TransactionSql, variantId: string | null = null) {
  return sql.unsafe<MissingVariant[]>(
    `
    SELECT v.id AS variant_id,
           to_char(date_trunc('week', v.created_at), 'YYYY-MM-DD') AS creation_week,
           v.status AS variant_status,
           array_agg(DISTINCT mv.status::text ORDER BY mv.status::text) AS version_statuses,
           array_agg(DISTINCT m.id) AS master_ids,
           coalesce(array_agg(DISTINCT m.id) FILTER (
             WHERE mv.status = 'active' AND mv.deleted_at IS NULL AND m.deleted_at IS NULL
           ), '{}'::uuid[]) AS active_master_ids,
           bool_or(m.deleted_at IS NULL) AS has_live_master,
           bool_or(m.deleted_at IS NULL AND mv.deleted_at IS NULL) AS has_live_version,
           (SELECT count(DISTINCT sol.sales_order_id)::int
              FROM sales_order_lines sol
              JOIN fulfillment_order_creation_backlogs b ON b.sales_order_id = sol.sales_order_id
             WHERE sol.variant_id = v.id AND b.status = 'awaiting_matching') AS waiting_orders
      FROM product_variants v
      JOIN product_master_variants pmv ON pmv.variant_id = v.id
      JOIN product_master_versions mv ON mv.id = pmv.version_id AND mv.master_id = pmv.master_id
      JOIN product_masters m ON m.id = mv.master_id
     WHERE ($1::uuid IS NULL OR v.id = $1::uuid)
       AND NOT EXISTS (SELECT 1 FROM product_matchings matching WHERE matching.variant_id = v.id)
     GROUP BY v.id
     ORDER BY v.id
    `,
    [variantId],
  );
}

function report(rows: MissingVariant[]) {
  for (const dimension of ['creation_week', 'version_statuses', 'partition'] as const) {
    const groups = new Map<string, { variants: number; variants_with_waiting_orders: number }>();

    for (const row of rows) {
      const keys =
        dimension === 'version_statuses'
          ? row.version_statuses
          : [dimension === 'partition' ? backfillPartition(row) : row.creation_week];

      for (const key of keys) {
        const counts = groups.get(key) ?? { variants: 0, variants_with_waiting_orders: 0 };
        counts.variants++;
        counts.variants_with_waiting_orders += Number(row.waiting_orders > 0);
        groups.set(key, counts);
      }
    }

    console.log(dimension);
    console.table([...groups].sort(([a], [b]) => a.localeCompare(b)).map(([group, counts]) => ({ group, ...counts })));
  }

  console.log(
    `Missing variants: ${rows.length}; with awaiting_matching orders: ${rows.filter((r) => r.waiting_orders > 0).length}`,
  );
}

async function main() {
  const apply = backfillApplyMode(process.argv.slice(2), process.env.DRY_RUN);
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) throw new Error('DATABASE_URL must explicitly identify one tenant core database.');

  const url = new URL(databaseUrl);

  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.pathname.slice(1)) {
    throw new Error('DATABASE_URL must be a PostgreSQL URL with an explicit database name.');
  }

  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10 });

  try {
    console.log(apply ? 'APPLY' : 'DRY_RUN=1');
    console.log('Only matching rows are inserted; sellable projections, policies and outbox are unchanged.');
    console.log('Pending rows do not unblock fulfillment; resolving in /order/matching wakes the backlog.');
    const rows = await sql.begin('read only', (tx) => findMissingVariants(tx));
    report(rows);

    if (!apply) return;

    let inserted = 0;

    for (const candidate of rows.filter((row) => backfillPartition(row) === 'eligible')) {
      inserted += await sql.begin(async (tx) => {
        await tx.unsafe('SELECT pg_advisory_xact_lock(hashtext($1))', [candidate.variant_id]);
        const [current] = await findMissingVariants(tx, candidate.variant_id);

        if (!current || backfillPartition(current) !== 'eligible') return 0;

        const created = await tx.unsafe(
          `
          INSERT INTO product_matchings (variant_id, master_id, status, priority, strategy, is_resolved)
          VALUES ($1, $2, 'pending', 'high', NULL, false)
          ON CONFLICT (variant_id) DO NOTHING
          RETURNING variant_id
          `,
          [current.variant_id, current.active_master_ids[0]],
        );

        if (created.length) console.log(`Inserted pending matching: ${current.variant_id}`);

        return created.length;
      });
    }

    console.log(`Inserted: ${inserted}; other candidates were skipped or changed concurrently.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Backfill failed.');
    process.exitCode = 1;
  });
}
