import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClaimedExport, FormExportJobManager } from './form-export-job.manager';
import { FormExportManager } from './form-export.manager';

/**
 * 양식 생성 잡 워커. ProductImportJobWorker 와 같은 모양이다 — @Cron + 원자적 claim.
 * 한 틱은 잡 하나를 통째로 조립한다(워크북은 부분 산출물이 없다). isProcessing 가드가
 * 틱 누적을 막는다.
 *
 * `ScheduleModule.forRoot()` 는 앱 어딘가에서 한 번만 부르면 되고(전역 모듈이라
 * `apps/core/src/modules/inventory/core/inventory.module.ts:39` 의 등록이 앱 전체에
 * 적용된다) 전역 discovery 로 이 `@Cron` 을 찾는다 — `ProductImportJobWorker` 가 자기
 * 모듈에서 `ScheduleModule` 을 다시 import 하지 않는 것과 같은 이유다. 이 클래스가
 * `BulkSessionModule.providers` 에 등록되기만 하면 된다.
 */
@Injectable()
export class FormExportJobWorker {
  private readonly logger = new Logger(FormExportJobWorker.name);
  private isProcessing = false;

  constructor(
    private readonly jobManager: FormExportJobManager,
    private readonly manager: FormExportManager,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    return this.config.get<string>('FORM_EXPORT_WORKER_ENABLED') !== 'false';
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async tick(): Promise<void> {
    if (!this.enabled) return;
    if (this.isProcessing) {
      this.logger.debug('이전 양식 조립 진행 중, 건너뜀');
      return;
    }

    this.isProcessing = true;
    let claimed: ClaimedExport | null = null;
    try {
      claimed = await this.jobManager.claim();
      if (!claimed) return;
      const owned = await this.jobManager.runExport(claimed);
      // 여기 도달했다는 건 조립이 예외 없이 끝났다는 뜻이다. catch 에서 부르면 안 된다
      // (리셋이 상한을 영원히 막는다). owned 가 false 면 CAS 에서 lease 를 이미 잃었다는
      // 뜻이다 — runExport 가 자체적으로 경고 로그를 남긴다. 이때 리셋을 부르면 내(좀비)
      // 카운터가 아니라 **후임의 살아있는 잡**의 카운터를 0 으로 되돌리게 된다.
      if (owned) await this.jobManager.clearConsecutiveFailures(claimed.exportId);
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      // 두 번째 인자를 넘겨야 Nest 가 스택을 찍는다 — 예상 못 한 예외에서 유일한 단서다.
      this.logger.error(
        `양식 조립 실패 (export=${claimed?.exportId ?? 'none'}): ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      // 토큰을 같이 넘겨야 recordJobError 의 CAS 가 성립한다 — 내가 이미 lease 를 잃은
      // 좀비라면 그쪽에서 0행을 매치해 조용히 버린다(후임의 lease 를 깎지 않는다).
      if (claimed) await this.jobManager.recordJobError(claimed.exportId, claimed.leaseToken, message);
    } finally {
      this.isProcessing = false;
    }
  }

  /** 만료된 잡과 워크북을 정리한다. 하루 한 번이면 충분하다. */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purge(): Promise<void> {
    if (!this.enabled) return;
    const removed = await this.manager.purgeExpired(new Date());
    if (removed > 0) this.logger.log(`만료된 양식 생성 잡 ${removed}건을 정리했습니다`);
  }
}
