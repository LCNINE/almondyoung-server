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
    // Step 1: Fetch file_contexts from template database
    logger.step(1, 2, 'Fetching file_contexts from template database');

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
    logger.step(2, 2, 'Inserting file_contexts into target database');

    for (const context of fileContexts) {
      await targetDb.execute(sql`
        INSERT INTO file_contexts (
          id, name, description, allow_public, allow_private,
          allowed_mime_types, max_file_size, path_prefix, is_active
        )
        VALUES (
          ${context.id},
          ${context.name},
          ${context.description ?? null},
          ${context.allowPublic},
          ${context.allowPrivate},
          ${JSON.stringify(context.allowedMimeTypes)},
          ${context.maxFileSize},
          ${context.pathPrefix},
          ${context.isActive}
        )
        ON CONFLICT (id) DO NOTHING
      `);
    }

    logger.success(`Inserted ${fileContexts.length} file contexts`);
    logger.success('File Service seeding completed successfully');
  } catch (error) {
    logger.error('File Service seeding failed', error);
    throw error;
  } finally {
    await targetClient.end();
    await templateClient.end();
  }
}
