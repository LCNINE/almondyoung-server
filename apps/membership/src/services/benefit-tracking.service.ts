import { Injectable, Logger } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { SubscriptionService } from './subscription.service';
import { BenefitReader } from './benefit/benefit.reader';
import { BenefitManager } from './benefit/benefit.manager';
import { RecordDiscountDto } from '../shared/dto/benefit-tracking.dto';

// 하위 호환성을 위한 타입 export
export type { CurrentCycleBenefit, CycleBenefitHistory } from './benefit/benefit.reader';

/**
 * 혜택 추적 서비스 (Business Layer)
 *
 * 역할: 비즈니스 흐름만 표현 (2-3줄)
 * - 검증 로직 없음 (Manager가 담당)
 * - 상세 구현 없음 (Manager가 담당)
 * - 협력 도구 클래스들을 중계
 */
@Injectable()
export class BenefitTrackingService {
  private readonly logger = new Logger(BenefitTrackingService.name);

  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly benefitReader: BenefitReader,
    private readonly benefitManager: BenefitManager,
  ) {}

  /**
   * 주문 완료 시 혜택 기록 (외부 시스템에서 호출)
   *
   * ✅ 흐름만 표현: "구독 조회 → 혜택 기록"
   */
  async recordDiscount(dto: RecordDiscountDto): Promise<void> {
    const subscription = await this.subscriptionService.getActiveSubscription(dto.userId);

    if (!subscription) {
      this.logger.warn('No active subscription', {
        userId: dto.userId,
        orderId: dto.orderId,
      });
      return;
    }

    await this.benefitManager.recordDiscount({
      orderId: dto.orderId,
      userId: dto.userId,
      membershipDiscountAmount: dto.membershipDiscountAmount,
      tierId: dto.tierId ?? subscription.tierId,
      orderDate: dto.orderDate,
      subscriptionId: subscription.id,
      billingDate: subscription.billingDate,
    });
  }

  /**
   * 주문 취소 시 혜택 차감 (외부 시스템에서 호출)
   *
   * ✅ 흐름만 표현: "이벤트 조회 → 혜택 취소"
   */
  async cancelDiscount(orderId: string): Promise<void> {
    const event = await this.benefitReader.findDiscountEventByOrderId(orderId);

    if (!event) {
      this.logger.error('Event not found', { orderId });
      throw new Error('DISCOUNT_EVENT_NOT_FOUND');
    }

    await this.benefitManager.cancelDiscount(orderId, event);
  }

  /**
   * 현재 주기 혜택 조회
   *
   * ✅ 흐름만 표현: "구독 조회 → 혜택 조회"
   */
  async getCurrentCycleBenefit(userId: string) {
    const subscription = await this.subscriptionService.getActiveSubscription(userId);

    if (!subscription) {
      // 활성 구독이 없는 것은 정상적인 비즈니스 상태 — 500 이 아니라 404 로 내려간다.
      // GlobalExceptionFilter 가 ApplicationException → HTTP status 로 매핑한다.
      throw new NotFoundError('활성화된 구독이 없습니다');
    }

    return this.benefitReader.findCurrentCycleBenefit(userId, subscription.billingDate, subscription.type);
  }

  /**
   * 주기별 혜택 이력 조회
   *
   * ✅ 흐름만 표현: "이력 조회"
   */
  async getCycleBenefitHistory(userId: string, limit: number = 12) {
    return this.benefitReader.findCycleBenefitHistory(userId, limit);
  }
}
