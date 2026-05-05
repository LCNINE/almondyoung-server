#!/usr/bin/env ts-node
/**
 * sync-mappings-from-medusa.ts
 *
 * Medusa 컨테이너 내부 백필(`backfill-from-core`) 직후 1회 실행해
 * `pim_medusa_mappings` 테이블을 갱신한다. Medusa Admin API 로 모든 product 를
 * 페이지네이션해 metadata.pimMasterId 가 있는 항목만 추려 upsert.
 *
 * 사용:
 *   npm run migrate:sync-mappings
 *
 * ENV:
 *   DATABASE_URL      channel-adapter DB
 *   MEDUSA_API_URL
 *   MEDUSA_API_KEY    sk_*
 */
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import Medusa from '@medusajs/js-sdk';
import { channelAdapterSchema, pimMedusaMappings } from '../src/schema';

const sqlExcluded = (column: string) => sql.raw(`EXCLUDED.${column}`);

interface MedusaProductSlim {
  id: string;
  handle?: string | null;
  metadata?: Record<string, unknown> | null;
}

function validateEnv(): void {
  const required = ['DATABASE_URL', 'MEDUSA_API_URL', 'MEDUSA_API_KEY'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error('❌ Missing env:', missing.join(', '));
    process.exit(1);
  }
}

async function main() {
  validateEnv();

  const sdk = new Medusa({
    baseUrl: process.env.MEDUSA_API_URL!,
    apiKey: process.env.MEDUSA_API_KEY,
  });

  const sqlClient = (postgres as any).default ?? postgres;
  const dbClient = sqlClient(process.env.DATABASE_URL!, { max: 1, idle_timeout: 20, connect_timeout: 60 });
  const db = drizzle(dbClient, { schema: channelAdapterSchema });

  console.log('📋 Listing Medusa products with pimMasterId metadata...');
  const limit = 100;
  let offset = 0;
  let totalScanned = 0;
  let totalUpserted = 0;
  let totalSkipped = 0;
  const start = Date.now();

  try {
    while (true) {
      const { products, count } = await sdk.admin.product.list({
        limit,
        offset,
        fields: 'id,handle,+metadata',
      });
      if (!products || products.length === 0) break;
      totalScanned += products.length;

      const rows: Array<{
        pimMasterId: string;
        medusaProductId: string;
        medusaHandle: string;
      }> = [];
      for (const p of products as unknown as MedusaProductSlim[]) {
        const pimMasterId = (p.metadata as any)?.pimMasterId;
        if (!pimMasterId || typeof pimMasterId !== 'string') {
          totalSkipped += 1;
          continue;
        }
        rows.push({ pimMasterId, medusaProductId: p.id, medusaHandle: p.handle ?? '' });
      }

      if (rows.length > 0) {
        // 일괄 upsert (drizzle onConflictDoUpdate). 멱등하므로 여러 번 돌려도 안전.
        await db
          .insert(pimMedusaMappings)
          .values(
            rows.map((r) => ({
              pimMasterId: r.pimMasterId,
              medusaProductId: r.medusaProductId,
              medusaHandle: r.medusaHandle,
              syncStatus: 'synced',
              lastSyncAction: 'created' as const,
            })),
          )
          .onConflictDoUpdate({
            target: pimMedusaMappings.pimMasterId,
            set: {
              medusaProductId: sqlExcluded(pimMedusaMappings.medusaProductId.name),
              medusaHandle: sqlExcluded(pimMedusaMappings.medusaHandle.name),
              syncStatus: 'synced',
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            },
          });
        totalUpserted += rows.length;
      }

      console.log(
        `  scanned=${totalScanned} upserted=${totalUpserted} skipped=${totalSkipped} (page ${offset / limit + 1})`,
      );

      if (products.length < limit) break;
      offset += limit;
      // 페이지 사이 약한 rate limit
      await new Promise((r) => setTimeout(r, 50));
    }

    console.log(`\n✅ Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
    console.log(`   Total products scanned: ${totalScanned}`);
    console.log(`   Mappings upserted:      ${totalUpserted}`);
    console.log(`   Skipped (no pim id):    ${totalSkipped}`);
  } finally {
    await dbClient.end();
  }
}

main().catch((err) => {
  console.error('❌ sync-mappings-from-medusa failed:', err);
  process.exit(1);
});
