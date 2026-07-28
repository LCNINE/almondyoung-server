import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ProductImportJobManager, ClaimedSession } from './product-import-job.manager';

/**
 * 대량등록 잡 워커. OutboxDispatcher 와 같은 모양이다 — @Cron + 원자적 claim.
 *
 * 한 틱은 세션 하나의 슬라이스 하나만 돈다. isProcessing 가드가 틱 누적을 막고,
 * 슬라이스가 틱 길이를 유계로 만든다.
 *
 * ScheduleModule.forRoot() 는 앱 어딘가에서 한 번만 부르면 되고
 * (apps/core/src/modules/inventory/core/inventory.module.ts:39) 전역 discovery 로
 * 이 @Cron 을 찾는다 — fulfillment.module.ts:78 과 같은 관례다.
 */
@Injectable()
export class ProductImportJobWorker {
  private readonly logger = new Logger(ProductImportJobWorker.name);
  private isProcessing = false;

  constructor(
    private readonly jobManager: ProductImportJobManager,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    return this.config.get<string>('PRODUCT_IMPORT_WORKER_ENABLED') !== 'false';
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async tick(): Promise<void> {
    if (!this.enabled) return;
    if (this.isProcessing) {
      this.logger.debug('이전 임포트 잡 슬라이스 진행 중, 건너뜀');
      return;
    }

    this.isProcessing = true;
    let claimed: ClaimedSession | null = null;
    let kind: 'commit' | 'publish' = 'commit';
    try {
      // commit 이 우선이다 — 생성이 끝나야 게시할 것이 생긴다.
      claimed = await this.jobManager.claimCommit();
      if (claimed) {
        await this.jobManager.runCommitSlice(claimed);
        return;
      }
      kind = 'publish';
      claimed = await this.jobManager.claimPublish();
      if (claimed) {
        await this.jobManager.runPublishSlice(claimed);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      // 두 번째 인자를 넘겨야 Nest 가 스택을 찍는다 — 예상 못 한 예외에서 유일한 단서다.
      this.logger.error(
        `임포트 잡 슬라이스 실패 (session=${claimed?.sessionId ?? 'none'}): ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      if (claimed) await this.jobManager.recordJobError(claimed.sessionId, kind, message);
    } finally {
      this.isProcessing = false;
    }
  }
}
