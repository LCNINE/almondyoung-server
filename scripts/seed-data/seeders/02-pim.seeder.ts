import { drizzle } from 'drizzle-orm/postgres-js';
import { InferInsertModel, sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as pimSchema from '../../../apps/pim/src/schema';
import { Logger } from '../shared/logger';
import { FIXED_UUIDS } from '../constants/uuids';

const logger = new Logger('PIM Seeder');

type SalesChannelInsert = InferInsertModel<typeof pimSchema.salesChannels>;

export async function seedPIM(databaseUrl: string): Promise<void> {
  logger.info('Starting PIM seeding');

  const client = postgres(databaseUrl);
  const db = drizzle(client);

  try {
    // Step 1: Insert Sales Channel
    logger.step(1, 1, 'Inserting sales channel');

    const salesChannel: SalesChannelInsert = {
      id: FIXED_UUIDS.CHANNEL_ALMONDYOUNG_MEDUSA,
      type: 'ONLINE',
      site: 'MEDUSA',
      name: '아몬드영 자사몰',
      isActive: true,
    };

    await db.execute(sql`
      INSERT INTO sales_channels (id, type, site, name, is_active)
      VALUES (
        ${salesChannel.id},
        ${salesChannel.type},
        ${salesChannel.site},
        ${salesChannel.name},
        ${salesChannel.isActive}
      )
      ON CONFLICT (id) DO NOTHING
    `);

    logger.success('Inserted sales channel: 아몬드영 자사몰');
    logger.success('PIM seeding completed successfully');
  } catch (error) {
    logger.error('PIM seeding failed', error);
    throw error;
  } finally {
    await client.end();
  }
}
