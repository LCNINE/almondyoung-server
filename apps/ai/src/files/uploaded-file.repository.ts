import { DbService, InjectTypedDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import { and, asc, count, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { assistantUploadedFiles, type AiSchema } from '../db/schema';

export type UploadedFileRow = typeof assistantUploadedFiles.$inferSelect;

/** 어시스턴트가 올린 파일 추적의 DB 접근. 이 파일 밖에서 drizzle 을 부르지 않는다. */
@Injectable()
export class UploadedFileRepository {
  constructor(@InjectTypedDb<AiSchema>() private readonly dbService: DbService<AiSchema>) {}

  /**
   * 같은 fileId 가 다시 오면 무시한다. 업로드마다 새 uuid 라 보통 안 겹치지만,
   * 겹쳤을 때 기록이 터져서 업로드가 실패하면 안 된다.
   */
  async record(fileId: string, contextId: string, sessionId: string | null): Promise<void> {
    await this.dbService.db
      .insert(assistantUploadedFiles)
      .values({ fileId, contextId, sessionId })
      .onConflictDoNothing();
  }

  /** 아직 판정하지 않은 것 중 유예가 지난 것. stuck 행은 큐에서 뺀다. */
  async findUnchecked(uploadedBefore: Date, limit: number): Promise<UploadedFileRow[]> {
    return this.dbService.db
      .select()
      .from(assistantUploadedFiles)
      .where(
        and(
          isNull(assistantUploadedFiles.stuckAt),
          isNull(assistantUploadedFiles.releasedAt),
          lt(assistantUploadedFiles.uploadedAt, uploadedBefore),
        ),
      )
      .orderBy(asc(assistantUploadedFiles.uploadedAt))
      .limit(limit);
  }

  /** soft delete 를 요청한 것 중 S3 유예까지 지난 것. stuck 행은 큐에서 뺀다. */
  async findReleasedBefore(releasedBefore: Date, limit: number): Promise<UploadedFileRow[]> {
    return this.dbService.db
      .select()
      .from(assistantUploadedFiles)
      .where(
        and(
          isNull(assistantUploadedFiles.stuckAt),
          isNotNull(assistantUploadedFiles.releasedAt),
          lt(assistantUploadedFiles.releasedAt, releasedBefore),
        ),
      )
      .orderBy(asc(assistantUploadedFiles.releasedAt))
      .limit(limit);
  }

  async markReleased(fileIds: string[]): Promise<void> {
    if (fileIds.length === 0) return;
    await this.dbService.db
      .update(assistantUploadedFiles)
      .set({ releasedAt: new Date() })
      .where(inArray(assistantUploadedFiles.fileId, fileIds));
  }

  /**
   * 자동으로는 더 못 고치는 행을 큐에서 뺀다. 지우지는 않는다 — 기록이 사라지면
   * 깨진 상품 이미지를 아무도 모른다.
   */
  async markStuck(fileIds: string[]): Promise<void> {
    if (fileIds.length === 0) return;
    await this.dbService.db
      .update(assistantUploadedFiles)
      .set({ stuckAt: new Date() })
      .where(inArray(assistantUploadedFiles.fileId, fileIds));
  }

  /** 사람이 봐야 하는 행의 수. 크론이 매 주기 로그에 싣는다. */
  async countStuck(): Promise<number> {
    const [result] = await this.dbService.db
      .select({ value: count() })
      .from(assistantUploadedFiles)
      .where(isNotNull(assistantUploadedFiles.stuckAt));
    return result?.value ?? 0;
  }

  /** 추적을 그만둔다. 상품에 붙은 파일과 이미 지운 파일 양쪽에 쓴다. */
  async forget(fileIds: string[]): Promise<void> {
    if (fileIds.length === 0) return;
    await this.dbService.db.delete(assistantUploadedFiles).where(inArray(assistantUploadedFiles.fileId, fileIds));
  }
}
