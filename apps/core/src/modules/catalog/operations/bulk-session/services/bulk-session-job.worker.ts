import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BulkSessionJobManager, ClaimedBulkSession } from './bulk-session-job.manager';

/**
 * 일괄 세션 검증 레인 워커. ProductImportJobWorker·FormExportJobWorker 와 같은 모양이다 —
 * `@Cron` + 원자적 claim + `isProcessing` 가드.
 *
 * 한 틱은 세션 하나의 슬라이스 하나만 돈다. 클레임한 phase 가 레인을 가른다: `uploaded`
 * 면 파싱(1회), 그 밖(`validating`)이면 검증 슬라이스다. 슬라이스가 틱 길이를 유계로
 * 만들고, `isProcessing` 가드가 틱 누적을 막는다.
 *
 * `ScheduleModule.forRoot()` 는 앱 어딘가에서 한 번만 부르면 되고(전역 모듈이라
 * `apps/core/src/modules/inventory/core/inventory.module.ts:39` 의 등록이 앱 전체에
 * 적용된다) 전역 discovery 로 이 `@Cron` 을 찾는다 — 이 클래스가
 * `BulkSessionModule.providers` 에 등록되기만 하면 된다.
 */
@Injectable()
export class BulkSessionJobWorker {
  private readonly logger = new Logger(BulkSessionJobWorker.name);
  private isProcessing = false;

  constructor(
    private readonly jobManager: BulkSessionJobManager,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    return this.config.get<string>('PRODUCT_BULK_SESSION_WORKER_ENABLED') !== 'false';
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async tick(): Promise<void> {
    if (!this.enabled) return;
    if (this.isProcessing) {
      this.logger.debug('이전 일괄 세션 슬라이스 진행 중, 건너뜀');
      return;
    }

    this.isProcessing = true;
    let claimed: ClaimedBulkSession | null = null;
    try {
      claimed = await this.jobManager.claim();
      if (!claimed) return;
      if (claimed.phase === 'uploaded') await this.jobManager.runParseSlice(claimed);
      else await this.jobManager.runValidateSlice(claimed);
      // 여기 도달했다는 건 슬라이스가 예외 없이 끝났다는 뜻이다. catch 에서 부르면 안 된다
      // (리셋이 연속 실패 상한을 영원히 막는다).
      await this.jobManager.clearConsecutiveFailures(claimed.sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      // 두 번째 인자를 넘겨야 Nest 가 스택을 찍는다 — 예상 못 한 예외에서 유일한 단서다.
      this.logger.error(
        `일괄 세션 슬라이스 실패 (session=${claimed?.sessionId ?? 'none'}): ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      if (claimed) await this.jobManager.recordJobError(claimed.sessionId, message);
    } finally {
      this.isProcessing = false;
    }
  }
}
