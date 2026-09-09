import { Injectable, Logger } from '@nestjs/common';
import { CronOnceMetadata } from './cron-once.constants';
import { CronRunClaimer } from './cron-run.claimer';
import { computePeriodAt } from './period-key';

/**
 * `@CronOnce` 메서드를 «주기당 한 번» 콜백으로 감싼다: 주기 키 도출 → 선점 → 본문 → 완료 기록.
 *
 * - 선점 못 함(다른 태스크가 먼저) → 본문 생략, debug.
 * - 선점 쿼리 실패(DB 불통 등) → 본문 생략, error. 본문은 어차피 DB 를 쓰므로 건너뛰는 편이 낫다.
 * - 본문 throw → error 기록 + error 로그. Nest 의 `@Cron` 래퍼와 같이 프로세스를 죽이지 않는다.
 *
 * 반환 함수는 절대 reject 하지 않는다 — `cron` 의 onTick 에서 던져진 예외는 unhandled 가 된다.
 */
@Injectable()
export class CronOnceRunner {
  private readonly logger = new Logger('CronOnce');

  constructor(private readonly claimer: CronRunClaimer) {}

  wrap(meta: CronOnceMetadata, body: () => Promise<unknown>, now: () => Date = () => new Date()): () => Promise<void> {
    return async () => {
      let periodAt: Date;
      try {
        periodAt = computePeriodAt(meta.expression, now(), meta.timeZone);
      } catch (error) {
        this.logger.error(`invalid schedule for ${meta.name}: ${meta.expression}`, error);
        return;
      }

      let claimed: boolean;
      try {
        claimed = await this.claimer.claim(meta.name, periodAt);
      } catch (error) {
        this.logger.error(`claim failed, skipping ${meta.name}@${periodAt.toISOString()}`, error);
        return;
      }
      if (!claimed) {
        this.logger.debug(`skip ${meta.name}@${periodAt.toISOString()}: claimed by another instance`);
        return;
      }

      let outcome: 'ok' | 'error' = 'ok';
      try {
        await body();
      } catch (error) {
        outcome = 'error';
        this.logger.error(`${meta.name}@${periodAt.toISOString()} failed`, error);
      }
      try {
        await this.claimer.finish(meta.name, periodAt, outcome);
      } catch (error) {
        this.logger.error(`finish failed for ${meta.name}@${periodAt.toISOString()}`, error);
      }
    };
  }
}
