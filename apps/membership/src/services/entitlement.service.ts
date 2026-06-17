import { Injectable, Logger } from '@nestjs/common';
import type { SubscriptionEntitlement } from '../shared/schemas';
import { EntitlementReader } from './entitlement/entitlement.reader';
import { EntitlementManager } from './entitlement/entitlement.manager';
import { MembershipEventPublisher } from './membership-event.publisher';
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
  private readonly logger = new Logger(EntitlementService.name);

  constructor(
    private readonly reader: EntitlementReader,
    private readonly manager: EntitlementManager,
    private readonly membershipEventPublisher: MembershipEventPublisher,
  ) {}

  /**
   * 구독 상태 체크 및 자동 만료 처리 (Lazy Expiration)
   *
   * @deprecated 이 메서드는 더 이상 사용되지 않습니다.
   * 스케줄러가 주기적으로 만료된 구독을 처리하도록 변경되었습니다.
   *
   * @reason GET 요청 시 lazy 연산을 제거하여 성능 개선 및
   * 만료일 당일 결제 완료까지 멤버십 혜택을 유지하기 위함
   *
   * @see 스케줄러 구현 예정: 매일 새벽 만료된 구독의 isCurrent를 false로 업데이트
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
    return this.manager.createEntitlement(tx, userId, tierId, startsAt, endsAt, sourceBatchId);
  }

  /**
   * 권한 연장/차감
   *
   * ✅ 흐름만 표현: "권한 조정"
   */
  async adjustEntitlement(userId: string, days: number, reason: string, adminId: string) {
    const result = await this.manager.adjustEntitlement(userId, days, reason, adminId);
    this.membershipEventPublisher
      .publishStatusChanged({
        userId,
        status: 'RESUMED',
        occurredAt: new Date().toISOString(),
        tierId: result.tierId,
        reasonCode: 'ENTITLEMENT_ADJUSTED',
        reasonText: reason,
      })
      .catch((err: Error) =>
        this.logger.error(`MembershipStatusChanged Kafka 발행 실패 (userId=${userId}): ${err?.message}`, err?.stack),
      );
    return result;
  }

  /**
   * 관리자 직접 지급 (일수 + 메모)
   */
  async grantByDays(userId: string, days: number, memo: string | null, adminId: string) {
    const result = await this.manager.grantByDays(userId, days, memo, adminId);
    this.membershipEventPublisher
      .publishStatusChanged({
        userId,
        status: 'ACTIVE',
        occurredAt: new Date().toISOString(),
        contractId: result.contractId,
        planId: result.planId,
        tierId: result.tierId,
      })
      .catch((err: Error) =>
        this.logger.error(`MembershipStatusChanged Kafka 발행 실패 (userId=${userId}): ${err?.message}`, err?.stack),
      );
    return result.entitlement;
  }

  /**
   * 권한 연장 (하위 호환성)
   *
   * ✅ 흐름만 표현: "권한 연장"
   */
  async extendEntitlement(userId: string, additionalDays: number, reason: string, adminId?: string): Promise<void> {
    await this.adjustEntitlement(userId, additionalDays, reason, adminId || 'system');
  }

  /**
   * 여러 사용자의 권한 정보 일괄 조회
   */
  async getBulkUserEntitlements(userIds: string[]) {
    const results = await this.reader.getBulkUserEntitlementDetails(userIds);

    // userId를 키로 하는 Map으로 변환
    const entitlementMap = new Map(
      results.map((r) => [
        r.entitlement.userId,
        {
          entitlement: r.entitlement,
          contract: r.contract,
          plan: r.plan,
          tier: r.tier,
        },
      ]),
    );

    return entitlementMap;
  }
}
