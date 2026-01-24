import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { Logger } from '../shared/logger';

const logger = new Logger('File Service Seeder');

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

  const targetSql = postgres(databaseUrl);
  const templateSql = postgres(templateDbUrl);

  const targetDb = drizzle(targetSql);
  const templateDb = drizzle(templateSql);

  try {
    // Step 1: Fetch file_contexts from template database
    logger.step(1, 2, 'Fetching file_contexts from template database');

    const fileContexts = await templateDb.execute<{
      id: string;
      name: string;
      description: string | null;
      allow_public: boolean;
      allow_private: boolean;
      allowed_mime_types: any;
      max_file_size: number;
      path_prefix: string;
      is_active: boolean;
    }>(templateSql`SELECT * FROM file_contexts`);

    logger.info(`Found ${fileContexts.length} file contexts in template DB`);

    if (fileContexts.length === 0) {
      logger.warn('No file_contexts found in template database');
      logger.success('File Service seeding completed (no data to copy)');
      return;
    }

    // Step 2: Insert into target database
    logger.step(2, 2, 'Inserting file_contexts into target database');

    for (const context of fileContexts) {
      await targetDb.execute(targetSql`
        INSERT INTO file_contexts (
          id, name, description, allow_public, allow_private,
          allowed_mime_types, max_file_size, path_prefix, is_active
        )
        VALUES (
          ${context.id},
          ${context.name},
          ${context.description ?? null},
          ${context.allow_public},
          ${context.allow_private},
          ${JSON.stringify(context.allowed_mime_types)},
          ${context.max_file_size},
          ${context.path_prefix},
          ${context.is_active}
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
    await targetSql.end();
    await templateSql.end();
  }
}
