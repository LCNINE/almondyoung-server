// src/providers/point-charge.provider.ts

import { Injectable } from '@nestjs/common';
import { PointService } from '../services/points/point.service'; // 실제 경로로 수정
import {
  ChargePort,
  PaymentResult,
  PointsPayload,
  ProviderType,
} from './payment-provider.interface';
@Injectable()
export class PointChargeProvider implements ChargePort<ProviderType.POINTS> {
  constructor(private readonly pointService: PointService) {}

  async process(payload: PointsPayload): Promise<PaymentResult> {
    try {
      // PointService의 redeem 메서드를 호출합니다.
      const result = await this.pointService.redeem({
        partnerId: payload.partnerId,
        amount: payload.amount,
        reason: payload.reason ?? 'ORDER_PAYMENT',
      });

      // ChargePort가 요구하는 PaymentResult 형태로 변환하여 반환합니다.
      return {
        success: true,
        transactionId: `point_event_${result.eventId}`,
        code: 'SUCCESS',
        raw: result,
      };
    } catch (error) {
      return {
        success: false,
        code: 'INSUFFICIENT_POINTS',
        message: error.message,
        raw: error,
      };
    }
  }
}
