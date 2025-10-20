// apps/wallet/src/services/referral-reward-v2.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PointService } from './point.service';
import { PointRepository } from './point.repository';

/**
 * CTO 철학:
 * - Wallet 서버는 "집행"만: 추천 보상 정책 수치(얼마 줄지)는 상위에서 내려주거나 환경변수/설정으로 관리
 * - 외부 HTTP 호출 불필요. UserService가 필요하면 내부 RPC/DB로 의존(여기서는 생략/의존 주입 가능)
 */
@Injectable()
export class ReferralRewardService {
  private readonly logger = new Logger(ReferralRewardService.name);

  constructor(
    private readonly pointService: PointService,
    private readonly pointRepo: PointRepository,
  ) {}

  /**
   * 추천 보상 지급
   * - 중복 방지: mallId + memberId unique
   * - 성공 시: point_events/point_event_details 에 EARN 기록
   */
  async rewardIfEligible(params: {
    mallId: string;
    memberId: string;
    partnerId: number; // 포인트 소유자(지급 대상) partner.id
    amount: number;
    reason?: string; // 예: 'referral_bonus'
    memo?: string; // 로깅용
  }): Promise<{ rewarded: boolean; eventId?: number }> {
    // 1) 중복 보상 여부 확인
    const exists = await this.pointRepo.existsReferralReward(
      params.mallId,
      params.memberId,
    );
    if (exists) {
      this.logger.warn(
        `Referral reward duplicated: mall=${params.mallId}, member=${params.memberId}`,
      );
      return { rewarded: false };
    }

    // 2) 보상 집행
    const earnRes = await this.pointService.addPoints({
      partnerId: params.partnerId,
      amount: params.amount,
      reason: params.reason ?? 'referral_reward',
      memo: params.memo ?? undefined,
      // 만료/출금가능일은 정책적으로 정할 수 있음(예: 100년/즉시)
    });

    // 3) 중복 방지 기록 (requestId는 내부 로그 시퀀스를 흉내내  eventId로 기록해도 무방)
    await this.pointRepo.insertReferralReward({
      mallId: params.mallId,
      memberId: params.memberId,
      requestId: earnRes.eventId, // 간단히 eventId로 넣어 추적 가능
    });

    this.logger.log(
      `Referral rewarded: partner=${params.partnerId} amount=${params.amount} event=${earnRes.eventId}`,
    );
    return { rewarded: true, eventId: earnRes.eventId };
  }
}
