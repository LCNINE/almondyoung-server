import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { SeedStep } from './base-seed-step';
import { SeedCheckResult, SeedApplyResult } from '../lib/types';

export interface FileServiceConfig {
  templateDbUrl?: string;
  s3PublicBucket?: string;
  s3PrivateBucket?: string;
}

export class FileServiceSeedStep extends SeedStep {
  private config: FileServiceConfig;

  constructor(databaseUrl: string, config: FileServiceConfig) {
    super('File Service', databaseUrl);
    this.config = config;
  }

  async check(): Promise<SeedCheckResult> {
    if (!this.config.templateDbUrl) {
      return {
        service: 'File Service',
        items: [
          { entity: 'file_contexts', expected: 0, existing: 0, missing: 0, missingDetails: ['(template DB URL not provided, skip)'] },
        ],
        isFullySeeded: true,
        summary: 'Skipped (no template DB URL)',
      };
    }

    const templateClient = postgres(this.config.templateDbUrl);
    try {
      const templateRows = await templateClient`SELECT count(*)::int as count FROM file_contexts`;
      const templateCount = templateRows[0].count;

      const targetRows = await this.client`SELECT count(*)::int as count FROM file_contexts`;
      const targetCount = targetRows[0].count;

      const missing = Math.max(0, templateCount - targetCount);

      const items = [
        {
          entity: 'file_contexts',
          expected: templateCount,
          existing: targetCount,
          missing,
          missingDetails: missing > 0 ? [`${missing} context(s) from template DB`] : undefined,
        },
      ];

      const isFullySeeded = missing === 0;
      return {
        service: 'File Service',
        items,
        isFullySeeded,
        summary: isFullySeeded ? 'All File Service seed data present' : `${missing} missing record(s)`,
      };
    } finally {
      await templateClient.end();
    }
  }

  async apply(): Promise<SeedApplyResult> {
    const start = Date.now();

    if (!this.config.templateDbUrl) {
      this.logger.warn('FILE_TEMPLATE_DB_URL not provided, skipping');
      return { service: 'File Service', success: true, itemsApplied: 0, duration: Date.now() - start };
    }

    const templateClient = postgres(this.config.templateDbUrl);
    const templateDb = drizzle(templateClient);

    try {
      const totalSteps = (this.config.s3PublicBucket || this.config.s3PrivateBucket) ? 3 : 2;

      // Step 1: Fetch from template
      this.logger.step(1, totalSteps, 'Fetching file_contexts from template database');
      const fileContexts = await templateDb.execute(sql`SELECT * FROM file_contexts`);
      this.logger.info(`Found ${fileContexts.length} file contexts in template DB`);

      if (fileContexts.length === 0) {
        this.logger.warn('No file_contexts found in template database');
        return { service: 'File Service', success: true, itemsApplied: 0, duration: Date.now() - start };
      }

      // Step 2: Insert into target
      this.logger.step(2, totalSteps, 'Inserting file_contexts into target database');
      for (const context of fileContexts) {
        const row = context as Record<string, unknown>;
        await this.db.execute(sql`
          INSERT INTO file_contexts (
            id, name, description, allow_public, allow_private,
            allowed_mime_types, max_file_size, path_prefix, is_active
          )
          VALUES (
            ${row.id}, ${row.name}, ${row.description ?? null},
            ${row.allow_public}, ${row.allow_private},
            ${JSON.stringify(row.allowed_mime_types)},
            ${row.max_file_size}, ${row.path_prefix}, ${row.is_active}
          )
          ON CONFLICT (id) DO NOTHING
        `);
      }

      // Step 3: Fix S3 bucket names
      if (this.config.s3PublicBucket || this.config.s3PrivateBucket) {
        this.logger.step(3, totalSteps, 'Fixing uploads URL bucket names');

        if (this.config.s3PublicBucket) {
          const pub = this.config.s3PublicBucket;
          const result = await this.db.execute(sql`
            UPDATE uploads
            SET url = regexp_replace(url, 'https://[^.]+\.s3\.', ${'https://' + pub + '.s3.'})
            WHERE is_public = true
            AND url LIKE 'https://%.s3.%amazonaws.com/%'
            AND url NOT LIKE ${'https://' + pub + '.s3.%'}
          `);
          this.logger.info(`Fixed ${(result as any).count ?? 0} public upload URLs`);
        }

        if (this.config.s3PrivateBucket) {
          const priv = this.config.s3PrivateBucket;
          const result = await this.db.execute(sql`
            UPDATE uploads
            SET url = regexp_replace(url, 'https://[^.]+\.s3\.', ${'https://' + priv + '.s3.'})
            WHERE is_public = false
            AND url LIKE 'https://%.s3.%amazonaws.com/%'
            AND url NOT LIKE ${'https://' + priv + '.s3.%'}
          `);
          this.logger.info(`Fixed ${(result as any).count ?? 0} private upload URLs`);
        }
      }

      this.logger.success('File Service seeding completed');
      return { service: 'File Service', success: true, itemsApplied: fileContexts.length, duration: Date.now() - start };
    } catch (error: any) {
      this.logger.error('File Service seeding failed', error);
      return { service: 'File Service', success: false, itemsApplied: 0, duration: Date.now() - start, error: error.message };
    } finally {
      await templateClient.end();
    }
  }
}
