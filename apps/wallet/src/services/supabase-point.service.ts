// services/supabase-point.service.ts - Supabase 포인트 시스템 서비스

import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { WalletTx } from '../shared/database';
import { SupabasePointRepository } from '../repositories/supabase-point.repository';
import {
  PointEarnRequestDto,
  PointEarnResponseDto,
  PointRedeemRequestDto,
  PointRedeemResponseDto,
  PointEarnCancelRequestDto,
  PointEarnCancelAllRequestDto,
  PointCancelResponseDto,
  PointGetRequestDto,
  PointGetResponseDto,
  PointGetWithdrawableResponseDto,
  PointHistoryQueryDto,
  PointHistoryResponseDto,
  PointHistoryItemDto,
  TriggerRewardProcessRequestDto,
  TriggerRewardProcessResponseDto,
  HandleNewReferralRequestDto,
  HandleNewReferralResponseDto,
  SupabasePointAction,
} from '../shared/dtos/supabase-point.dto';

/**
 * Supabase 포인트 시스템 서비스
 * - 실제 Supabase 함수들을 TypeScript로 구현
 * - CTO 스타일: 서비스는 도메인 로직만, 컨트롤러에서 HTTP 변환
 */
@Injectable()
export class SupabasePointService {
  private readonly logger = new Logger(SupabasePointService.name);

  constructor(
    private readonly db: DbService<typeof import('../shared/database/schema')>,
    private readonly pointRepo: SupabasePointRepository,
  ) {}

  // ================================================================
  // point_earn 함수 구현
  // ================================================================

  /**
   * 포인트 적립 (Supabase point_earn 함수와 동일)
   */
  async pointEarn(
    request: PointEarnRequestDto,
    tx?: WalletTx,
  ): Promise<PointEarnResponseDto> {
    this.logger.log(
      `포인트 적립 시작: partnerId=${request.partnerId}, amount=${request.amount}`,
    );

    try {
      const result = await this.pointRepo.pointEarn(
        request.partnerId,
        request.amount,
        request.orderId,
        request.reason,
        tx,
      );

      this.logger.log(
        `포인트 적립 완료: eventId=${result.eventId}, eventDetailId=${result.eventDetailId}`,
      );

      return {
        eventId: result.eventId,
        eventDetailId: result.eventDetailId,
        amount: request.amount,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`포인트 적립 실패: ${error.message}`, error.stack);
      throw new Error(`포인트 적립 실패: ${error.message}`);
    }
  }

  // ================================================================
  // point_redeem 함수 구현
  // ================================================================

  /**
   * 포인트 사용 (Supabase point_redeem 함수와 동일 - FIFO)
   */
  async pointRedeem(
    request: PointRedeemRequestDto,
    tx?: WalletTx,
  ): Promise<PointRedeemResponseDto> {
    this.logger.log(
      `포인트 사용 시작: partnerId=${request.partnerId}, amount=${request.amount}`,
    );

    try {
      const result = await this.pointRepo.pointRedeem(
        request.partnerId,
        request.amount,
        request.reason,
        tx,
      );

      this.logger.log(
        `포인트 사용 완료: eventId=${result.eventId}, fifoDetails=${JSON.stringify(result.fifoDetails)}`,
      );

      return {
        eventId: result.eventId,
        amount: request.amount,
        fifoDetails: result.fifoDetails,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`포인트 사용 실패: ${error.message}`, error.stack);
      throw new Error(`포인트 사용 실패: ${error.message}`);
    }
  }

  // ================================================================
  // point_earn_cancel 함수 구현
  // ================================================================

  /**
   * 포인트 적립 취소 (Supabase point_earn_cancel 함수와 동일)
   */
  async pointEarnCancel(
    request: PointEarnCancelRequestDto,
    tx?: WalletTx,
  ): Promise<PointCancelResponseDto> {
    this.logger.log(
      `포인트 적립 취소 시작: partnerId=${request.partnerId}, eventId=${request.eventIdToCancel}, amount=${request.cancelAmount}`,
    );

    try {
      const result = await this.pointRepo.pointEarnCancel(
        request.partnerId,
        request.eventIdToCancel,
        request.cancelAmount,
        request.reason,
        tx,
      );

      this.logger.log(
        `포인트 적립 취소 완료: eventId=${result.eventId}, eventDetailId=${result.eventDetailId}`,
      );

      return {
        eventId: result.eventId,
        eventDetailId: result.eventDetailId,
        amount: -request.cancelAmount,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`포인트 적립 취소 실패: ${error.message}`, error.stack);
      throw new Error(`포인트 적립 취소 실패: ${error.message}`);
    }
  }

  /**
   * 포인트 적립 전체 취소 (Supabase point_earn_cancel_all 함수와 동일)
   */
  async pointEarnCancelAll(
    request: PointEarnCancelAllRequestDto,
    tx?: WalletTx,
  ): Promise<PointCancelResponseDto> {
    this.logger.log(
      `포인트 적립 전체 취소 시작: partnerId=${request.partnerId}, eventId=${request.eventIdToCancel}`,
    );

    try {
      const result = await this.pointRepo.pointEarnCancelAll(
        request.partnerId,
        request.eventIdToCancel,
        request.reason,
        tx,
      );

      this.logger.log(
        `포인트 적립 전체 취소 완료: eventId=${result.eventId}, canceledAmount=${result.canceledAmount}`,
      );

      return {
        eventId: result.eventId,
        eventDetailId: result.eventDetailId,
        amount: -result.canceledAmount,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `포인트 적립 전체 취소 실패: ${error.message}`,
        error.stack,
      );
      throw new Error(`포인트 적립 전체 취소 실패: ${error.message}`);
    }
  }

  // ================================================================
  // point_get 함수 구현
  // ================================================================

  /**
   * 포인트 조회 (Supabase point_get 함수와 동일)
   */
  async pointGet(
    request: PointGetRequestDto,
    tx?: WalletTx,
  ): Promise<PointGetResponseDto> {
    this.logger.log(`포인트 조회: partnerId=${request.partnerId}`);

    try {
      const totalPoints = await this.pointRepo.pointGet(request.partnerId, tx);

      return {
        partnerId: request.partnerId,
        totalPoints,
        queriedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`포인트 조회 실패: ${error.message}`, error.stack);
      throw new Error(`포인트 조회 실패: ${error.message}`);
    }
  }

  /**
   * 출금 가능 포인트 조회 (Supabase point_get_withdrawable 함수와 동일)
   */
  async pointGetWithdrawable(
    request: PointGetRequestDto,
    tx?: WalletTx,
  ): Promise<PointGetWithdrawableResponseDto> {
    this.logger.log(`출금 가능 포인트 조회: partnerId=${request.partnerId}`);

    try {
      const withdrawablePoints = await this.pointRepo.pointGetWithdrawable(
        request.partnerId,
        tx,
      );

      return {
        partnerId: request.partnerId,
        withdrawablePoints,
        queriedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `출금 가능 포인트 조회 실패: ${error.message}`,
        error.stack,
      );
      throw new Error(`출금 가능 포인트 조회 실패: ${error.message}`);
    }
  }

  // ================================================================
  // 포인트 히스토리 조회
  // ================================================================

  /**
   * 포인트 히스토리 조회
   */
  async getPointHistory(
    query: PointHistoryQueryDto,
    tx?: WalletTx,
  ): Promise<PointHistoryResponseDto> {
    this.logger.log(`포인트 히스토리 조회: partnerId=${query.partnerId}`);

    try {
      const result = await this.pointRepo.getPointHistory(
        query.partnerId,
        {
          eventType: query.eventType,
          page: query.page || 1,
          limit: query.limit || 20,
        },
        tx,
      );

      const items: PointHistoryItemDto[] = result.events.map((event) => ({
        id: event.id,
        partnerId: event.partnerId,
        eventType: event.eventType as SupabasePointAction,
        amount: event.amount,
        expiresAt: event.expiresAt?.toISOString(),
        withdrawalAvailableAt: event.withdrawalAvailableAt?.toISOString(),
        reason: event.reason || undefined,
        memo: event.memo || undefined,
        orderId: event.orderId || undefined,
        originalEventId: event.originalEventId || undefined,
        createdAt: event.createdAt.toISOString(),
      }));

      return {
        items,
        totalCount: result.totalCount,
        currentPage: result.currentPage,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      };
    } catch (error) {
      this.logger.error(
        `포인트 히스토리 조회 실패: ${error.message}`,
        error.stack,
      );
      throw new Error(`포인트 히스토리 조회 실패: ${error.message}`);
    }
  }

  // ================================================================
  // trigger_reward_process 함수 구현
  // ================================================================

  /**
   * Supabase trigger_reward_process 함수와 동일
   * - 외부 API 호출 (GET + POST)
   * - POST 요청의 request_id 반환
   */
  async triggerRewardProcess(
    request: TriggerRewardProcessRequestDto,
    tx?: WalletTx,
  ): Promise<TriggerRewardProcessResponseDto> {
    this.logger.log(`추천인 보상 프로세스 시작: memberId=${request.memberId}`);

    try {
      // TODO: 실제 외부 API 호출 구현
      // const getRequestId = await this.httpClient.get(
      //   `https://asia-northeast3-almond-auth.cloudfunctions.net/api/member/almond/${request.memberId}`
      // );

      // const postRequestId = await this.httpClient.post(
      //   `https://asia-northeast3-almond-auth.cloudfunctions.net/api/reward/referral/${request.memberId}`,
      //   {},
      //   {
      //     headers: {
      //       'almond-event-key': 'a36b09d1a163fd89d8725c5b3051eeace40e84e5bb229ad7d1393ec1147209d8'
      //     }
      //   }
      // );

      // Mock 구현 (실제 환경에서는 위 코드 사용)
      const mockRequestId = Math.floor(Math.random() * 100000) + 10000;

      this.logger.log(
        `추천인 보상 프로세스 완료: memberId=${request.memberId}, requestId=${mockRequestId}`,
      );

      return {
        requestId: mockRequestId,
        processedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `추천인 보상 프로세스 실패: ${error.message}`,
        error.stack,
      );
      throw new Error(`추천인 보상 프로세스 실패: ${error.message}`);
    }
  }

  // ================================================================
  // handle_new_referral 함수 구현
  // ================================================================

  /**
   * Supabase handle_new_referral 함수와 동일
   * - 중복 체크
   * - trigger_reward_process 호출
   * - referral_rewards 기록
   */
  async handleNewReferral(
    request: HandleNewReferralRequestDto,
    tx?: WalletTx,
  ): Promise<HandleNewReferralResponseDto> {
    this.logger.log(
      `새 추천인 보상 처리: mallId=${request.mallId}, memberId=${request.memberId}`,
    );

    return await this.db.db.transaction(async (transaction) => {
      const useTx = tx || transaction;

      try {
        // 1. 이미 혜택을 받았는지 확인
        const alreadyRewarded = await this.pointRepo.checkReferralRewardExists(
          request.mallId,
          request.memberId,
          useTx,
        );

        if (alreadyRewarded) {
          this.logger.log(
            `이미 보상 받은 멤버: mallId=${request.mallId}, memberId=${request.memberId}`,
          );

          return {
            success: true,
            rewardGranted: false,
            processedAt: new Date().toISOString(),
          };
        }

        // 2. 혜택 제공 프로세스 트리거
        const rewardResult = await this.triggerRewardProcess(
          { memberId: request.memberId },
          useTx,
        );

        // 3. 혜택 제공 후 기록
        await this.pointRepo.createReferralReward(
          request.mallId,
          request.memberId,
          rewardResult.requestId,
          useTx,
        );

        this.logger.log(
          `새 추천인 보상 처리 완료: mallId=${request.mallId}, memberId=${request.memberId}, requestId=${rewardResult.requestId}`,
        );

        return {
          success: true,
          rewardGranted: true,
          requestId: rewardResult.requestId,
          processedAt: new Date().toISOString(),
        };
      } catch (error) {
        this.logger.error(
          `새 추천인 보상 처리 실패: ${error.message}`,
          error.stack,
        );
        throw new Error(`새 추천인 보상 처리 실패: ${error.message}`);
      }
    });
  }
}
