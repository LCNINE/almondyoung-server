import { Injectable, Logger } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { type PimSchema, productImportImages, productImportSessions } from '../../../schema/catalog.schema';
import { ProductImportFileClient } from './product-import-file.client';

/**
 * 취소된 세션이 이미 올린 이미지를 지운다.
 *
 * file-service 에 고아 파일 정리 잡이 없어(스펙 §2.8) 안 지우면 S3 에 영구 잔존한다.
 * `product_import_images.file_id` 를 전부 추적하므로 정리는 싸고, 권한도 이미 통한다
 * (file-access.ts:62 가 scopes:['master'] 위임 토큰을 명시 허용한다).
 *
 * **트랜잭션 밖에서 돈다.** HTTP 호출을 DB 트랜잭션이 물면 커넥션이 초 단위로 잠긴다.
 * **실패는 로그만 남긴다** — 취소가 정리 때문에 실패하는 편이 더 나쁘다.
 *
 * ⚠️ 진행 중인 fetch 슬라이스가 정리 도중 한 장을 더 올릴 수 있다(슬라이스는 행마다
 * 취소를 확인하므로 창은 최대 한 장). 이걸 없애려면 정리를 워커로 옮겨야 하는데, 그러면
 * lease 를 아무도 안 들고 있는 세션 — 즉 대부분의 취소 시점 — 이 영영 정리되지 않는다.
 */
@Injectable()
export class ProductImportImageCleaner {
  private readonly logger = new Logger(ProductImportImageCleaner.name);

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly fileClient: ProductImportFileClient,
  ) {}

  async cleanupUploaded(sessionId: string): Promise<void> {
    const { uploadedBy, fileIds } = await this.db.run(async (trx) => {
      const [session] = await trx
        .select({ uploadedBy: productImportSessions.uploadedBy })
        .from(productImportSessions)
        .where(eq(productImportSessions.id, sessionId))
        .limit(1);
      const rows = await trx
        .select({ fileId: productImportImages.fileId })
        .from(productImportImages)
        // status 가 아니라 **fileId 존재 여부**로 정리 대상을 정한다. 업로드는 성공했는데
        // 그 직후 상태 기록(status: 'uploaded') 이 던지면 행이 'probed'/'fetch_failed'
        // 등으로 남을 수 있다 — status='uploaded' 로 좁히면 그 파일이 영영 정리 대상에서
        // 빠져 S3 에 고아로 남는다(§finding4).
        .where(and(eq(productImportImages.sessionId, sessionId), isNotNull(productImportImages.fileId)));
      return {
        uploadedBy: session?.uploadedBy ?? null,
        fileIds: rows.map((row) => row.fileId).filter((id): id is string => typeof id === 'string'),
      };
    });

    if (fileIds.length === 0) return;
    if (!uploadedBy) {
      // 옛 세션은 uploaded_by 가 NULL 일 수 있다(컬럼이 nullable). 위임 토큰을 만들 수
      // 없으므로 지울 방법이 없다 — 조용히 넘기되 흔적은 남긴다.
      this.logger.warn(`업로더가 없는 세션이라 이미지 정리를 건너뛴다 (session=${sessionId}, files=${fileIds.length})`);
      return;
    }

    let failed = 0;
    for (const fileId of fileIds) {
      try {
        await this.fileClient.softDelete(fileId, uploadedBy);
      } catch (error) {
        failed += 1;
        this.logger.warn(`이미지 정리 실패 (session=${sessionId}, file=${fileId}): ${String(error)}`);
      }
    }
    this.logger.log(`취소 세션 이미지 정리 완료 (session=${sessionId}, 총 ${fileIds.length}건, 실패 ${failed}건)`);
  }
}
