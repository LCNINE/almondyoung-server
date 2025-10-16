import { Injectable, Logger } from '@nestjs/common';
import { PointService } from '../points/point.service';
import { IntentRepository } from '../intents/intent.repository';
import type { PaymentIntent } from '../../shared/database/types';
import type { DiscountLine } from '../../shared/database/schema';
import type { PaymentResult } from '../../providers/payment-provider.interface';

export interface PointResult {
  pointEventId: number | null;
  pointsUsed: number;
  finalAmount: number;
  isFullPayment: boolean;
  discounts: DiscountLine[];
}

/**
 * PaymentPointManager (Implementation Layer)
 *
 * 책임: Payment 도메인에서 Point 사용 처리
 * - 포인트 차감
 * - 할인 계산
 * - Intent 업데이트
 * - 포인트 전액 결제 처리
 */
@Injectable()
export class PaymentPointManager {
  private readonly logger = new Logger(PaymentPointManager.name);

  constructor(
    private readonly pointService: PointService,
    private readonly intentRepo: IntentRepository,
  ) {}

  /**
   * 포인트 적용 (검증 + 차감 + 할인 계산)
   */
  async applyPoints(
    intent: PaymentIntent,
    usePoints: number | undefined,
    tx: any,
  ): Promise<PointResult> {
    // 1. 포인트 사용 요청이 없는 경우
    if (!usePoints || usePoints <= 0) {
      return {
        pointEventId: null,
        pointsUsed: 0,
        finalAmount: Number(intent.amount),
        isFullPayment: false,
        discounts: [],
      };
    }

    this.logger.log(`Applying ${usePoints} points to intent ${intent.id}`);

    // 2. partnerId = customerId (동일한 개념, UUIDv7)
    const partnerId = intent.customerId;
    this.logger.log(`Using partnerId ${partnerId} for intent ${intent.id}`);

    // 3. 포인트 잔액 체크
    const balance = await this.pointService.getBalance(partnerId);
    this.logger.log(`Current point balance: ${balance}`);

    if (balance < usePoints) {
      throw new Error(
        `Insufficient points. Balance: ${balance}, Required: ${usePoints}`,
      );
    }

    // 4. 포인트 차감
    const redeemResult = await this.pointService.redeem(
      {
        partnerId,
        amount: usePoints,
        reason: 'PAYMENT',
        memo: `Intent: ${intent.id}`,
      },
      tx,
    );

    this.logger.log(
      `Points redeemed successfully. EventId: ${redeemResult.eventId}`,
    );

    // 5. 할인 정보 생성
    const discounts: DiscountLine[] = [
      {
        type: 'POINTS',
        amount: usePoints,
        pointEventId: redeemResult.eventId,
        appliedAt: new Date(),
      },
    ];

    const finalAmount = Number(intent.amount) - usePoints;
    const isFullPayment = finalAmount === 0;

    // 6. Intent에 할인 정보 업데이트
    await this.intentRepo.updateDiscounts(
      intent.id,
      discounts,
      usePoints,
      finalAmount,
      tx,
    );

    this.logger.log(
      `Points applied. Final amount: ${finalAmount}, Full payment: ${isFullPayment}`,
    );

    return {
      pointEventId: redeemResult.eventId,
      pointsUsed: usePoints,
      finalAmount,
      isFullPayment,
      discounts,
    };
  }

  /**
   * 포인트 전액 결제 완료 처리
   */
  async completePointOnlyPayment(
    intent: PaymentIntent,
    pointResult: PointResult,
    tx: any,
  ): Promise<PaymentResult> {
    this.logger.log(`포인트 전액 결제 - Intent ${intent.id} CAPTURED 처리`);

    await this.intentRepo.markAsCaptured(intent.id, tx);

    return {
      success: true,
      message: '포인트 전액 결제 완료',
      transactionId: intent.id,
      attemptId: null,
      pointEventId: pointResult.pointEventId,
      breakdown: {
        totalAmount: Number(intent.amount),
        pointsUsed: pointResult.pointsUsed,
        finalAmount: 0,
      },
    };
  }
}
