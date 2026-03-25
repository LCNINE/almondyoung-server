#!/usr/bin/env ts-node

import * as postgresPkg from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { salesChannels, channelProducts, productMasters, productMasterVersions } from '../src/schema';
import { eq, sql } from 'drizzle-orm';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL is required');
  }

  console.log(`Using database: ${dbUrl.replace(/:[^:@]+@/, ':***@')}`);

  const createSqlClient = (postgresPkg as any).default ?? (postgresPkg as any);
  const client = createSqlClient(dbUrl, { max: 1 });
  const db = drizzle(client, {
    schema: {
      salesChannels,
      channelProducts,
      productMasters,
      productMasterVersions,
    },
  });

  try {
    console.log('🔍 Finding or creating Medusa sales channel (site=medusa)...');
    const existingChannels = await db.select().from(salesChannels).where(eq(salesChannels.site, 'medusa')).limit(1);

    let medusaChannelId: string;

    if (existingChannels.length === 0) {
      const [created] = await db
        .insert(salesChannels)
        .values({
          site: 'medusa',
          name: 'Medusa',
          type: 'ONLINE',
          description: 'Medusa storefront',
          isActive: true,
        })
        .returning();

      medusaChannelId = created.id;
      console.log(`✅ Created Medusa channel: ${medusaChannelId}`);
    } else {
      medusaChannelId = existingChannels[0].id;
      console.log(`ℹ️  Medusa channel already exists: ${medusaChannelId} (${existingChannels[0].name})`);

      if (!existingChannels[0].isActive) {
        const [updated] = await db
          .update(salesChannels)
          .set({ isActive: true, updatedAt: new Date() })
          .where(eq(salesChannels.id, medusaChannelId))
          .returning();

        console.log(`   ↳ Channel was inactive, set to active at ${updated.updatedAt.toISOString()}`);
      }
    }

    console.log('\n🔍 Loading active masters...');
    const activeMasterRows = await db.execute<{ masterId: string }>(sql`
      SELECT DISTINCT pmv.master_id AS "masterId"
      FROM product_master_versions pmv
      INNER JOIN product_masters pm ON pm.id = pmv.master_id
      WHERE pmv.status = 'active'
        AND pmv.deleted_at IS NULL
        AND pm.deleted_at IS NULL
    `);

    const activeMasterIds = activeMasterRows.map((row) => row.masterId);
    console.log(`   Found ${activeMasterIds.length} active masters.`);

    if (activeMasterIds.length === 0) {
      console.log('   No active masters found. Nothing to map.');
      return;
    }

    const existingMappings = await db
      .select({ masterId: channelProducts.masterId })
      .from(channelProducts)
      .where(eq(channelProducts.channelId, medusaChannelId));

    const mappedMasterIds = new Set(existingMappings.map((row) => row.masterId));
    const missingMasterIds = activeMasterIds.filter((id) => !mappedMasterIds.has(id));

    console.log(`   Already mapped: ${mappedMasterIds.size}, to add: ${missingMasterIds.length}`);

    if (missingMasterIds.length === 0) {
      console.log('✅ All active masters are already linked to Medusa.');
      return;
    }

    console.log('\n🔗 Inserting channel-product links...');
    const batchSize = 500;
    let inserted = 0;

    await db.transaction(async (tx) => {
      for (let i = 0; i < missingMasterIds.length; i += batchSize) {
        const batch = missingMasterIds.slice(i, i + batchSize);
        await tx.insert(channelProducts).values(
          batch.map((masterId) => ({
            masterId,
            channelId: medusaChannelId,
            isActive: true,
          })),
        );

        inserted += batch.length;
        console.log(`   ↳ Inserted ${inserted}/${missingMasterIds.length}`);
      }
    });

    console.log('\n✅ Done linking active masters to Medusa channel.');
    console.log(`   Total now mapped (existing + new): ${mappedMasterIds.size + inserted}`);
  } catch (error: any) {
    console.error('❌ Failed to set up Medusa channel mappings:', error?.message || error);
    if (error?.stack) {
      console.error(error.stack);
    }
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
