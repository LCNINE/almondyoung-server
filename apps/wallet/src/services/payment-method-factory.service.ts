// services/payment-method-factory.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { PaymentMethodAdapterPort } from '../ports/payment-method-adapter.port';
import { PaymentAdapter } from '../ports/payment-adapter.port';
import { TossCardAdapter } from '../adapters/toss-card.adapter';

import { BNPLService } from './bnpl.service';

/**
 * 결제수단 타입별 어댑터 팩토리
 * - 각 결제수단 타입에 맞는 어댑터 제공
 * - BNPL은 어댑터 없이 직접 서비스 반환
 */
@Injectable()
export class PaymentMethodFactoryService {
  constructor(
    private readonly tossCardAdapter: TossCardAdapter,

    private readonly bnplService: BNPLService,
  ) {}

  /**
   * 결제수단 등록용 어댑터 반환 (기존 기능 유지)
   */
  getAdapter(
    methodType: 'CARD' | 'REWARD_POINT',
  ): PaymentMethodAdapterPort | null {
    switch (methodType) {
      case 'CARD':
        return this.tossCardAdapter;

      default:
        throw new BadRequestException(
          `지원하지 않는 결제수단 타입: ${methodType as string}`,
        );
    }
  }

  /**
   * 결제 처리용 어댑터 반환 (새로운 기능)
   */
  getPaymentAdapter(
    methodType: 'CARD' | 'REWARD_POINT' | 'BNPL',
  ): PaymentAdapter | BNPLService | null {
    switch (methodType) {
      case 'CARD':
        return this.tossCardAdapter;
      case 'BNPL':
        return this.bnplService; // BNPL은 어댑터 없이 직접 서비스 반환
      default:
        throw new BadRequestException(
          `지원하지 않는 결제수단 타입: ${methodType as string}`,
        );
    }
  }

  /**
   * 어댑터가 필요한 결제수단 타입인지 확인
   */
  requiresAdapter(methodType: string): boolean {
    return methodType === 'CARD' || methodType === 'REWARD_POINT';
  }

  /**
   * BNPL 결제수단인지 확인
   */
  isBNPL(methodType: string): boolean {
    return methodType === 'BNPL';
  }
}
