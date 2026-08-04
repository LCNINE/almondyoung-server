import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDb, DbService } from '@app/db';
import { and, eq, isNotNull, notExists, sql } from 'drizzle-orm';
import {
  type PimSchema,
  productBulkImages,
  productBulkItems,
  productBulkSessions,
} from '../../../schema/catalog.schema';
import { FormExportFileClient } from './form-export-file.client';

/**
 * 한 틱에 지우는 파일 수. 파일마다 file-service HTTP 왕복이 하나라 틱 길이를 유계로
 * 만드는 것이 목적이다. 남은 것은 다음 틱이 이어받는다 — 스윕은 완주할 필요가 없다.
 */
export const IMAGE_CLEANUP_BATCH = 100;

/**
 * 취소된 세션이 올린 이미지 파일을 지운다.
 *
 * file-service 에 고아 파일 정리 잡이 없어(스펙 §2.7) 안 지우면 S3 에 영구 잔존한다.
 *
 * **왜 취소 요청 안에서 하지 않는가**: 파싱 슬라이스가 세션당 이미지 행을 최대 1만 건까지
 * 만든다. 순차 soft delete 1만 회는 ALB 60초를 한참 넘긴다 — 취소는 즉시 끝나야 하는
 * 동작이다(v3 는 인라인이었지만 그쪽은 규모가 달랐다).
 *
 * **왜 `draft_version_id` 를 보는가**: `cancel` 은 `published`·`canceled` 를 뺀 모든
 * phase 에서 허용되므로 `drafting` **이후** 취소도 된다. 스펙 §3.12 는 그때는 draft 가
 * 참조 중이므로 이미지를 **유지**하라고 한다. 3단계에는 4단계 워커가 없어 아직 도달할 수
 * 없는 상태지만, 4단계가 오는 순간 이 스윕이 draft 가 쓰는 파일을 지우게 된다. 지금부터
 * 막아 둔다 — `draft_version_id` 는 2단계 스키마에 이미 있어 마이그레이션이 필요 없다.
 *
 * **왜 `sourceKind='file_name'` 만인가**: `file_id` 행의 fileId 는 우리가 올린 것이
 * 아니라 작업자가 양식에 적어 넣은 **기존 상품 이미지**다. 지우면 살아있는 상품의
 * 이미지가 사라진다.
 */
@Injectable()
export class BulkImageCleaner {
  private readonly logger = new Logger(BulkImageCleaner.name);
  private isSweeping = false;

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly fileClient: FormExportFileClient,
    private readonly config: ConfigService,
  ) {}

  /**
   * 검증 레인과 **같은 킬스위치**를 쓴다. 하나의 기능이라 따로 끌 이유가 없고, 이름을
   * 늘리면 오타로 조용히 무시되는 자리만 는다(env 이름은 틀려도 아무 신호가 없다).
   */
  private get enabled(): boolean {
    return this.config.get<string>('PRODUCT_BULK_SESSION_WORKER_ENABLED') !== 'false';
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    if (!this.enabled) return;
    if (this.isSweeping) {
      this.logger.debug('이전 이미지 정리 스윕 진행 중, 건너뜀');
      return;
    }
    this.isSweeping = true;
    try {
      const { deleted, failed } = await this.sweepOnce();
      if (deleted > 0 || failed > 0) {
        this.logger.log(`취소 세션 이미지 정리 (삭제 ${deleted}건, 실패 ${failed}건)`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      this.logger.error(`이미지 정리 스윕 실패: ${message}`, error instanceof Error ? error.stack : undefined);
    } finally {
      this.isSweeping = false;
    }
  }

  /**
   * 한 배치를 처리한다. 크론 밖에서도 부를 수 있게 분리했다(테스트·수동 실행).
   *
   * **HTTP 는 트랜잭션 밖에서 돈다** — 대상 적재와 후처리만 각자 짧은 트랜잭션이다.
   */
  async sweepOnce(): Promise<{ deleted: number; failed: number }> {
    const targets = await this.db.run((trx) =>
      trx
        .select({
          id: productBulkImages.id,
          fileId: productBulkImages.fileId,
          uploadedBy: productBulkSessions.uploadedBy,
        })
        .from(productBulkImages)
        .innerJoin(productBulkSessions, eq(productBulkImages.sessionId, productBulkSessions.id))
        .where(
          and(
            eq(productBulkSessions.phase, 'canceled'),
            eq(productBulkImages.sourceKind, 'file_name'),
            isNotNull(productBulkImages.fileId),
            notExists(
              trx
                .select({ one: sql`1` })
                .from(productBulkItems)
                .where(
                  and(
                    eq(productBulkItems.sessionId, productBulkSessions.id),
                    isNotNull(productBulkItems.draftVersionId),
                  ),
                ),
            ),
          ),
        )
        // 실패한 행은 아래에서 updatedAt 을 갱신해 뒤로 보낸다 — 이 정렬이 그 밀어내기를
        // 성립시킨다. 없으면 영구 실패 파일 하나가 매 틱 배치 앞머리를 차지해 뒤의 정상
        // 행이 영영 안 지워진다.
        .orderBy(productBulkImages.updatedAt)
        .limit(IMAGE_CLEANUP_BATCH),
    );

    let deleted = 0;
    let failed = 0;

    for (const target of targets) {
      const fileId = target.fileId;
      if (!fileId) continue;

      if (!target.uploadedBy) {
        // 위임 토큰에 실을 userId 가 없으면 file-service 를 부를 수 없다. 지금 스키마는
        // uploaded_by 가 NOT NULL 이라 도달 불가지만, 도달하면 조용히 넘기지 않고 남긴다.
        this.logger.warn(`업로더가 없어 이미지 정리를 건너뜁니다 (image=${target.id})`);
        failed += 1;
        continue;
      }

      try {
        // `softDeleteOwnedFile` — master 없는 위임 토큰이라 file-service 가 업로더
        // 소유권을 강제한다. 이 스윕이 지우는 fileId 는 작업자가 통보한 값이므로
        // 남의 파일이 섞여 들어올 수 있고, 그때는 403 이 나 아래 catch 가 실패로 센다.
        await this.fileClient.softDeleteOwnedFile(fileId, target.uploadedBy);
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        this.logger.warn(`이미지 정리 실패 (image=${target.id}, file=${fileId}): ${message}`);
        failed += 1;
        await this.db.run((trx) =>
          trx.update(productBulkImages).set({ updatedAt: new Date() }).where(eq(productBulkImages.id, target.id)),
        );
        continue;
      }

      // 파일이 사라졌으므로 행도 "파일 없음" 상태로 되돌린다. 취소는 종단이라 이 세션이
      // 다시 업로드를 기다리는 일은 없고, 이 값이 다음 틱의 대상 술어에서 이 행을
      // 빼주므로 스윕이 멱등해진다 — 새 컬럼 없이 진행 상태를 표현하는 방법이다.
      await this.db.run((trx) =>
        trx
          .update(productBulkImages)
          .set({ fileId: null, status: 'awaiting_upload', updatedAt: new Date() })
          .where(eq(productBulkImages.id, target.id)),
      );
      deleted += 1;
    }

    return { deleted, failed };
  }
}
