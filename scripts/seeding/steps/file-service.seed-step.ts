import { sql } from 'drizzle-orm';
import { SeedStep } from './base-seed-step';
import { SeedCheckResult, SeedApplyResult } from '../lib/types';
import {
  ARCHIVE_PAGE_ATTACHMENT_CONTEXT_ID,
  DIGITAL_ASSET_FILE_CONTEXT_ID,
  FILE_CONTEXTS,
  fileContextMatchesSeed,
} from '../../../apps/file-service/src/database/default-file-contexts';
import type { FileContextSeedRow } from '../../../apps/file-service/src/database/default-file-contexts';

const CONTEXT_IDS = FILE_CONTEXTS.map((c) => c.id);

/**
 * 이 컨텍스트들은 «있으면 넘어가기»가 아니라 **소스 값으로 덮어쓴다.**
 *
 * 기본은 ON CONFLICT DO NOTHING 이다 — 운영에서 손으로 조정한 값을 시드가 되돌리면 안 되기 때문.
 * 그런데 그 규칙 때문에 **소스의 상한을 올려도 이미 있는 행은 안 바뀐다.** 실제로 아카이브 첨부
 * 상한을 100MB → 600MB 로 올렸는데 라이브가 그대로여서 업로드가 400 으로 죽었다.
 * 소스가 정본이어야 하는 컨텍스트는 여기 적는다.
 */
const OVERWRITE_FROM_SOURCE: readonly string[] = [DIGITAL_ASSET_FILE_CONTEXT_ID, ARCHIVE_PAGE_ATTACHMENT_CONTEXT_ID];
const CONTEXT_NAMES: Record<string, string> = Object.fromEntries(FILE_CONTEXTS.map((c) => [c.id, c.name]));

export class FileServiceSeedStep extends SeedStep {
  readonly groups = ['baseline'] as const;

  constructor(databaseUrl: string) {
    super('File Service', databaseUrl);
  }

  async check(): Promise<SeedCheckResult> {
    const rows = await this.client<FileContextSeedRow[]>`
      SELECT id, allow_public, allow_private, allowed_mime_types, max_file_size, path_prefix, is_active
      FROM file_contexts
      WHERE id = ANY(${CONTEXT_IDS})
    `;
    const existingById = new Map(rows.map((row) => [row.id, row]));
    const missingIds = CONTEXT_IDS.filter((id) => !existingById.has(id));
    const driftedIds = FILE_CONTEXTS.filter((ctx) => {
      if (!OVERWRITE_FROM_SOURCE.includes(ctx.id)) {
        return false;
      }

      const row = existingById.get(ctx.id);
      return row !== undefined && !fileContextMatchesSeed(row, ctx);
    }).map((ctx) => ctx.id);
    const missingOrDriftedIds = [...missingIds, ...driftedIds];

    const items = [
      {
        entity: 'file_contexts',
        expected: CONTEXT_IDS.length,
        existing: existingById.size,
        missing: missingOrDriftedIds.length,
        missingDetails: missingOrDriftedIds.map((id) =>
          driftedIds.includes(id) ? `${CONTEXT_NAMES[id]} (configuration drift)` : CONTEXT_NAMES[id],
        ),
      },
    ];

    const isFullySeeded = missingOrDriftedIds.length === 0;
    return {
      service: 'File Service',
      items,
      isFullySeeded,
      summary: isFullySeeded
        ? 'All File Service seed data present'
        : `${missingOrDriftedIds.length} missing or drifted record(s)`,
    };
  }

  async apply(): Promise<SeedApplyResult> {
    const start = Date.now();

    try {
      this.logger.step(1, 1, 'Inserting file_contexts');
      for (const ctx of FILE_CONTEXTS) {
        if (OVERWRITE_FROM_SOURCE.includes(ctx.id)) {
          await this.db.execute(sql`
            INSERT INTO file_contexts (
              id, name, description, allow_public, allow_private,
              allowed_mime_types, max_file_size, path_prefix, is_active
            )
            VALUES (
              ${ctx.id},
              ${ctx.name},
              ${ctx.description},
              ${ctx.allowPublic},
              ${ctx.allowPrivate},
              ${JSON.stringify(ctx.allowedMimeTypes)},
              ${ctx.maxFileSize},
              ${ctx.pathPrefix},
              ${ctx.isActive}
            )
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              description = EXCLUDED.description,
              allow_public = EXCLUDED.allow_public,
              allow_private = EXCLUDED.allow_private,
              allowed_mime_types = EXCLUDED.allowed_mime_types,
              max_file_size = EXCLUDED.max_file_size,
              path_prefix = EXCLUDED.path_prefix,
              is_active = EXCLUDED.is_active,
              updated_at = now()
          `);
        } else {
          await this.db.execute(sql`
            INSERT INTO file_contexts (
              id, name, description, allow_public, allow_private,
              allowed_mime_types, max_file_size, path_prefix, is_active
            )
            VALUES (
              ${ctx.id},
              ${ctx.name},
              ${ctx.description},
              ${ctx.allowPublic},
              ${ctx.allowPrivate},
              ${JSON.stringify(ctx.allowedMimeTypes)},
              ${ctx.maxFileSize},
              ${ctx.pathPrefix},
              ${ctx.isActive}
            )
            ON CONFLICT (id) DO NOTHING
          `);
        }
      }

      this.logger.success('File Service seeding completed');
      return {
        service: 'File Service',
        success: true,
        itemsApplied: FILE_CONTEXTS.length,
        duration: Date.now() - start,
      };
    } catch (error: any) {
      this.logger.error('File Service seeding failed', error);
      return {
        service: 'File Service',
        success: false,
        itemsApplied: 0,
        duration: Date.now() - start,
        error: error.message,
      };
    }
  }
}
