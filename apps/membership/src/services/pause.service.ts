import { Injectable } from '@nestjs/common';
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
  constructor(
    private readonly pauseReader: PauseReader,
    private readonly pauseManager: PauseManager,
    private readonly membershipEventPublisher: MembershipEventPublisher,
  ) {}

  /**
   * 구독 일시정지
   *
   * ✅ 흐름만 표현: "권한 조회 → 일시정지 실행"
   */
  async pauseSubscription(
    userId: string,
    email: string,
    startDate: Date,
    endDate: Date,
    reason?: string,
  ) {
    const entitlement =
      await this.pauseReader.findActiveNonPausedEntitlement(userId);
    if (!entitlement) {
      throw new Error('Active subscription not found');
    }

    const result = await this.pauseManager.startPause(
      userId,
      entitlement,
      startDate,
      endDate,
      reason,
    );

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
