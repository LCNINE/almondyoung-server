import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { format } from 'date-fns';
import { PauseReader } from './pause/pause.reader';
import { PauseManager } from './pause/pause.manager';
import { MembershipEventPublisher } from './membership-event.publisher';

// 하위 호환성을 위한 타입 export
export type { PauseResult, ResumeResult } from './pause/pause.manager';
export type { PauseHistoryItem } from './pause/pause.reader';

/**
 * 일시정지 서비스 (Business Layer)
 *
 * 역할: 비즈니스 흐름만 표현 (2-3줄)
 * - 검증 로직 없음 (Manager가 담당)
 * - 상세 구현 없음 (Manager가 담당)
 * - 협력 도구 클래스들을 중계
 */
@Injectable()
export class PauseService {
  private readonly logger = new Logger(PauseService.name);

  constructor(
    private readonly pauseReader: PauseReader,
    private readonly pauseManager: PauseManager,
    private readonly membershipEventPublisher: MembershipEventPublisher,
  ) {}

  /**
   * 일시정지 자동 재개 (매시간)
   *
   * 일시정지 종료일이 지난 권한을 자동으로 재개한다. 이 스케줄러가 없으면
   * 사용자가 수동 재개하지 않는 한 일시정지가 풀리지 않아 정기결제도 영구 중단된다.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async autoResumeExpiredPauses(): Promise<void> {
    const today = format(new Date(), 'yyyy-MM-dd');
    const due = await this.pauseReader.findEntitlementsDueForAutoResume(today);
    if (due.length === 0) return;

    this.logger.log(`일시정지 자동 재개 대상 ${due.length}건`);
    for (const entitlement of due) {
      try {
        await this.pauseManager.resumePause(entitlement.userId, entitlement);
        await this.membershipEventPublisher
          .publishStatusChanged({
            userId: entitlement.userId,
            status: 'RESUMED',
            occurredAt: new Date().toISOString(),
          })
          .catch((e: unknown) =>
            this.logger.warn(`RESUMED 이벤트 발행 실패 (userId=${entitlement.userId}): ${e instanceof Error ? e.message : String(e)}`),
          );
      } catch (err) {
        this.logger.error(
          `일시정지 자동 재개 실패 (userId=${entitlement.userId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * 구독 일시정지
   *
   * ✅ 흐름만 표현: "권한 조회 → 일시정지 실행"
   */
  async pauseSubscription(userId: string, email: string, startDate: Date, endDate: Date, reason?: string) {
    const entitlement = await this.pauseReader.findActiveNonPausedEntitlement(userId);
    if (!entitlement) {
      throw new Error('Active subscription not found');
    }

    const result = await this.pauseManager.startPause(userId, entitlement, startDate, endDate, reason);

    await this.membershipEventPublisher.publishStatusChanged({
      userId,
      email,
      status: 'PAUSED',
      occurredAt: new Date().toISOString(),
      reasonText: reason,
    });

    return result;
  }

  /**
   * 구독 재개
   *
   * ✅ 흐름만 표현: "권한 조회 → 일시정지 재개"
   */
  async resumeSubscription(userId: string, email: string) {
    const entitlement = await this.pauseReader.findPausedEntitlement(userId);
    if (!entitlement || !entitlement.pausedAt) {
      throw new Error('No paused subscription found');
    }

    const result = await this.pauseManager.resumePause(userId, entitlement);

    await this.membershipEventPublisher.publishStatusChanged({
      userId,
      email,
      status: 'RESUMED',
      occurredAt: new Date().toISOString(),
    });

    return result;
  }

  /**
   * 일시정지 이력 조회
   *
   * ✅ 흐름만 표현: "이력 조회"
   */
  async getPauseHistory(userId: string) {
    return this.pauseReader.findPauseHistory(userId);
  }
}
