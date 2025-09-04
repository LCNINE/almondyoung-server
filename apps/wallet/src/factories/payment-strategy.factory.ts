import { Injectable, BadRequestException } from '@nestjs/common';
import { BnplStrategy } from '../strategies/bnpl.strategy';
import { CardStrategy } from '../strategies/card.strategy';
import { PointStrategy } from '../strategies/point.strategy';
import {
  PaymentStrategy,
  BnplStrategyType,
  CardStrategyType,
  PointStrategyType,
  BatchProcessingStrategy,
} from '../strategies/payment.strategy.interface';

/**
 * @class PaymentStrategyFactory
 * @description methodType에 따라 적절한 Strategy 인스턴스를 생성하고 반환하는 팩토리 클래스
 *
 * 개선사항:
 * - 타입 안정성 강화 (any 타입 제거)
 * - Union 타입을 통한 컴파일 타임 안전성 확보
 */
@Injectable()
export class PaymentStrategyFactory {
  constructor(
    private readonly bnplStrategy: BnplStrategy,
    private readonly cardStrategy: CardStrategy,
    private readonly pointStrategy: PointStrategy,
  ) {}

  /**
   * methodType에 따라 적절한 전략을 반환 (타입 안전)
   * @param methodType 결제수단 타입
   * @returns 타입 안전한 Strategy 인스턴스
   */
  getStrategy(methodType: string): PaymentStrategy {
    switch (methodType) {
      case 'BNPL':
        return this.bnplStrategy as BnplStrategyType;
      case 'CARD':
      case 'EASY_PAY':
        return this.cardStrategy as CardStrategyType;
      case 'REWARD_POINT':
        return this.pointStrategy as PointStrategyType;
      default:
        throw new BadRequestException(
          `지원하지 않는 결제수단 타입: ${methodType}`,
        );
    }
  }

  /**
   * 배치 처리 가능한 전략만 반환 (타입 안전)
   */
  getBatchProcessingStrategy(methodType: string): BatchProcessingStrategy {
    const strategy = this.getStrategy(methodType);

    if (!('batchCapture' in strategy)) {
      throw new BadRequestException(
        `${methodType}는 배치 처리를 지원하지 않습니다`,
      );
    }

    return strategy as BatchProcessingStrategy;
  }
}
