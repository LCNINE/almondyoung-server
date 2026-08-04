import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDb, DbService } from '@app/db';
import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import { type PimSchema, productBulkSessions } from '../../../schema/catalog.schema';
import { FormExportFileClient } from './form-export-file.client';

/** 종단 세션의 워크북 보관 기간. 양식 잡의 만료(30일)와 같은 값을 쓴다 — 둘이 다르면 이유를 설명해야 한다. */
export const WORKBOOK_RETENTION_DAYS = 30;

/** 한 틱에 지우는 세션 수. 파일마다 file-service HTTP 왕복이 하나라 틱 길이를 유계로 만든다. */
export const WORKBOOK_CLEANUP_BATCH = 200;

/**
 * 끝난 세션의 원본 워크북을 지운다(스펙 §10.6, 부록 B.7 이 5단계 몫으로 남긴 것).
 *
 * `BulkImageCleaner`(취소 세션의 업로드 이미지)와 **다른 대상**이다. 여기서 지우는 것은
 * 작업자가 올린 엑셀 하나뿐이고, 취소만이 아니라 **발행 완료 세션도 대상**이다.
 *
 * 하루 한 번이면 충분하다 — 30일 보관에서 하루의 지연은 의미가 없고, 파일당 HTTP 왕복이
 * 하나라 매분 도는 크론에 얹을 이유가 없다.
 *
 * 킬스위치는 검증 레인·이미지 스윕과 **같은** `PRODUCT_BULK_SESSION_WORKER_ENABLED` 다 —
 * 하나의 기능이고, 이름을 늘리면 오타로 조용히 무시되는 자리만 는다.
 */
@Injectable()
export class BulkSessionCleaner {
  private readonly logger = new Logger(BulkSessionCleaner.name);
  private isSweeping = false;

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly fileClient: FormExportFileClient,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    return this.config.get<string>('PRODUCT_BULK_SESSION_WORKER_ENABLED') !== 'false';
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async sweep(): Promise<void> {
    if (!this.enabled) return;
    if (this.isSweeping) {
      this.logger.debug('이전 워크북 정리 스윕 진행 중, 건너뜀');
      return;
    }
    this.isSweeping = true;
    try {
      const { deleted, failed } = await this.sweepOnce(new Date());
      if (deleted > 0 || failed > 0) {
        this.logger.log(`만료 세션 워크북 정리 (삭제 ${deleted}건, 실패 ${failed}건)`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      this.logger.error(`워크북 정리 스윕 실패: ${message}`, error instanceof Error ? error.stack : undefined);
    } finally {
      this.isSweeping = false;
    }
  }

  /**
   * 한 배치를 처리한다. `now` 를 인자로 받는 이유는 `FormExportManager.purgeExpired` 와
   * 같다 — 테스트가 시계를 고정할 수 있어야 한다.
   *
   * **HTTP 는 트랜잭션 밖에서 돈다.** 실패한 행은 `sourceFileId` 를 남겨 다음 틱이 다시
   * 시도한다 — soft delete 는 멱등이라 두 번 불려도 안전하다.
   */
  async sweepOnce(now: Date): Promise<{ deleted: number; failed: number }> {
    const cutoff = new Date(now.getTime() - WORKBOOK_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const targets = await this.db.run((trx) =>
      trx
        .select({
          id: productBulkSessions.id,
          sourceFileId: productBulkSessions.sourceFileId,
          uploadedBy: productBulkSessions.uploadedBy,
        })
        .from(productBulkSessions)
        .where(
          and(
            inArray(productBulkSessions.phase, ['published', 'canceled']),
            isNotNull(productBulkSessions.sourceFileId),
            lt(productBulkSessions.updatedAt, cutoff),
          ),
        )
        .orderBy(productBulkSessions.updatedAt)
        .limit(WORKBOOK_CLEANUP_BATCH),
    );

    let deleted = 0;
    let failed = 0;

    for (const target of targets) {
      const fileId = target.sourceFileId;
      if (!fileId) continue;
      try {
        // 워크북 경로는 master 스코프 위임 토큰을 그대로 쓴다(부록 B.7) — 양식을 만든 사람과
        // 올린 사람이 다른 것이 정상 업무이고, 이 fileId 는 core 가 스스로 만들어 DB 에 적어
        // 둔 값이라 임의 주입 통로가 없다. 이미지 경로의 softDeleteOwnedFile 과 다르다.
        await this.fileClient.softDelete(fileId, target.uploadedBy);
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        this.logger.warn(`워크북 정리 실패 (session=${target.id}, file=${fileId}): ${message}`);
        failed += 1;
        continue;
      }

      await this.db.run((trx) =>
        trx.update(productBulkSessions).set({ sourceFileId: null }).where(eq(productBulkSessions.id, target.id)),
      );
      deleted += 1;
    }

    return { deleted, failed };
  }
}
