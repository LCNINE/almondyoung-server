import { drizzle } from 'drizzle-orm/postgres-js';
import { InferSelectModel, sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as fileSchema from '../../../apps/file-service/src/database/schema';
import { Logger } from '../shared/logger';

const logger = new Logger('File Service Seeder');

type FileContextSelect = InferSelectModel<typeof fileSchema.fileContexts>;

export async function seedFileService(
  databaseUrl: string,
  templateDbUrl?: string,
  s3Config?: { publicBucket?: string; privateBucket?: string },
): Promise<void> {
  logger.info('Starting File Service seeding');

  if (!templateDbUrl) {
    logger.warn(
      'FILE_TEMPLATE_DB_URL not provided, skipping file_contexts seeding',
    );
    logger.success('File Service seeding completed (skipped)');
    return;
  }

  const targetClient = postgres(databaseUrl);
  const templateClient = postgres(templateDbUrl);

  const targetDb = drizzle(targetClient);
  const templateDb = drizzle(templateClient);

  try {
    const totalSteps = s3Config?.publicBucket || s3Config?.privateBucket ? 3 : 2;

    // Step 1: Fetch file_contexts from template database
    logger.step(1, totalSteps, 'Fetching file_contexts from template database');

    const fileContexts = await templateDb.execute<FileContextSelect>(
      sql`SELECT * FROM file_contexts`,
    );

    logger.info(`Found ${fileContexts.length} file contexts in template DB`);

    if (fileContexts.length === 0) {
      logger.warn('No file_contexts found in template database');
      logger.success('File Service seeding completed (no data to copy)');
      return;
    }

    // Step 2: Insert into target database
    logger.step(2, totalSteps, 'Inserting file_contexts into target database');

    for (const context of fileContexts) {
      const row = context as Record<string, unknown>;
      await targetDb.execute(sql`
        INSERT INTO file_contexts (
          id, name, description, allow_public, allow_private,
          allowed_mime_types, max_file_size, path_prefix, is_active
        )
        VALUES (
          ${row.id},
          ${row.name},
          ${row.description ?? null},
          ${row.allow_public},
          ${row.allow_private},
          ${JSON.stringify(row.allowed_mime_types)},
          ${row.max_file_size},
          ${row.path_prefix},
          ${row.is_active}
        )
        ON CONFLICT (id) DO NOTHING
      `);
    }

    logger.success(`Inserted ${fileContexts.length} file contexts`);

    // Step 3: Fix uploads URL bucket names
    const publicBucket = s3Config?.publicBucket;
    const privateBucket = s3Config?.privateBucket;

    if (publicBucket || privateBucket) {
      logger.step(3, totalSteps, 'Fixing uploads URL bucket names');

      if (publicBucket) {
        const publicResult = await targetDb.execute(sql`
          UPDATE uploads
          SET url = regexp_replace(url, 'https://[^.]+\.s3\.', ${'https://' + publicBucket + '.s3.'})
          WHERE is_public = true
          AND url LIKE 'https://%.s3.%amazonaws.com/%'
          AND url NOT LIKE ${'https://' + publicBucket + '.s3.%'}
        `);
        logger.info(`Fixed ${publicResult.count} public upload URLs`);
      }

      if (privateBucket) {
        const privateResult = await targetDb.execute(sql`
          UPDATE uploads
          SET url = regexp_replace(url, 'https://[^.]+\.s3\.', ${'https://' + privateBucket + '.s3.'})
          WHERE is_public = false
          AND url LIKE 'https://%.s3.%amazonaws.com/%'
          AND url NOT LIKE ${'https://' + privateBucket + '.s3.%'}
        `);
        logger.info(`Fixed ${privateResult.count} private upload URLs`);
      }
    }

    logger.success('File Service seeding completed successfully');
  } catch (error) {
    logger.error('File Service seeding failed', error);
    throw error;
  } finally {
    await targetClient.end();
    await templateClient.end();
  }
}
