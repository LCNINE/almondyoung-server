import { Injectable } from '@nestjs/common';
import type { SubscriptionEntitlement } from '../shared/schemas';
import { EntitlementReader } from './entitlement/entitlement.reader';
import { EntitlementManager } from './entitlement/entitlement.manager';
import { DrizzleTransaction } from '../shared/schemas/types';

/**
 * EntitlementService (Business Layer)
 *
 * 역할: 비즈니스 흐름만 표현 (2-3줄)
 * - 검증 로직 없음 (Manager가 담당)
 * - 상세 구현 없음 (Manager가 담당)
 * - Reader/Manager를 중계
 */
@Injectable()
export class EntitlementService {
  constructor(
    private readonly reader: EntitlementReader,
    private readonly manager: EntitlementManager,
  ) {}

  /**
   * 구독 상태 체크 및 자동 만료 처리 (Lazy Expiration)
   *
   * ✅ 흐름만 표현: "권한 조회 → 만료 체크 → 만료 시 처리"
   *
   * @sideEffect 만료된 구독의 isCurrent 플래그를 false로 업데이트
   * @rationale 데이터 정합성 보장 및 성능 최적화
   */
  async checkAndUpdateSubscription(userId: string): Promise<boolean> {
    const entitlement = await this.reader.findActiveEntitlement(userId);
    if (!entitlement) return false;

    const today = new Date().toISOString().split('T')[0];
    const isExpired = entitlement.endsAt < today;

    if (isExpired) {
      await this.manager.expireEntitlement(entitlement.id, userId);
      return false;
    }

    return true;
  }

  /**
   * 사용자 권한 상세 조회
   *
   * ✅ 흐름만 표현: "권한 조회"
   */
  async getUserEntitlement(userId: string) {
    return this.reader.getUserEntitlementDetails(userId);
  }

  /**
   * 권한 생성
   *
   * ✅ 흐름만 표현: "권한 생성"
   */
  async createEntitlement(
    tx: DrizzleTransaction,
    userId: string,
    tierId: string,
    startsAt: Date,
    endsAt: Date,
    sourceBatchId: string,
  ): Promise<SubscriptionEntitlement> {
    return this.manager.createEntitlement(
      tx,
      userId,
      tierId,
      startsAt,
      endsAt,
      sourceBatchId,
    );
  }

  /**
   * 권한 연장/차감
   *
   * ✅ 흐름만 표현: "권한 조정"
   */
  async adjustEntitlement(
    userId: string,
    days: number,
    reason: string,
    adminId: string,
  ) {
    return this.manager.adjustEntitlement(userId, days, reason, adminId);
  }

  /**
   * 권한 연장 (하위 호환성)
   *
   * ✅ 흐름만 표현: "권한 연장"
   */
  async extendEntitlement(
    userId: string,
    additionalDays: number,
    reason: string,
    adminId?: string,
  ): Promise<void> {
    await this.manager.adjustEntitlement(
      userId,
      additionalDays,
      reason,
      adminId || 'system',
    );
  }
}
