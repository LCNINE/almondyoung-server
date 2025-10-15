import { Injectable } from '@nestjs/common';
import type { PaymentIntent } from '../../shared/database/types';
import type {
  PaymentRequest,
  PaymentType,
} from '../../providers/payment-provider.interface';
import { generateUUIDv7 } from '../../shared/utils/id-generator';

/**
 * PaymentRequestBuilder
 *
 * 책임:
 * - PaymentRequest 객체 조립
 * - 메타데이터 구성
 */
@Injectable()
export class PaymentRequestBuilder {
  /**
   * PaymentRequest 객체를 생성합니다.
   */
  build(
    intent: PaymentIntent,
    finalAmount: number,
    options: {
      profileId?: string;
      instrumentRef?: string;
      sessionId?: string;
      source?: string;
      actor?: string;
      pointEventId?: number | null;
      pointsUsed?: number;
    },
  ): PaymentRequest {
    return {
      intentId: intent.id,
      attemptId: generateUUIDv7(),
      amount: finalAmount,
      paymentType: intent.type as PaymentType,
      userId: intent.customerId,
      instrumentType: options.profileId ? 'PROFILE' : 'ONE_TIME',
      profileId: options.profileId,
      instrumentRef: options.instrumentRef,
      metadata: {
        sessionId: options.sessionId,
        source: options.source || 'api',
        actor: options.actor || 'SYSTEM',
        pointEventId: options.pointEventId,
        pointsUsed: options.pointsUsed || 0,
      },
    };
  }
}
