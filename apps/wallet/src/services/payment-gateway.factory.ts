// services/payment-gateway.factory.ts
import { Injectable, Inject } from '@nestjs/common';
import { PaymentGateway } from '../interfaces/payment-gateway.interface';
import {
  TOSS_PAYMENT_ADAPTER,
  HMS_CARD_PAYMENT_ADAPTER,
  HMS_BNPL_PAYMENT_ADAPTER,
  INTERNAL_POINT_PAYMENT_ADAPTER,
} from '../shared/tokens/gateway.tokens';

/**
 * 결제 게이트웨이 팩토리 (SOLID 원칙 준수)
 * - OCP: 새로운 게이트웨이 추가 시 기존 코드 수정 불필요
 * - DIP: 구체 클래스가 아닌 PaymentGateway 인터페이스에 의존
 * - SRP: 게이트웨이 선택 책임만 담당
 */
@Injectable()
export class PaymentGatewayFactory {
  private readonly gatewayMap = new Map<string, PaymentGateway>();
  private readonly methodTypeMap = new Map<string, string>();

  constructor(
    @Inject(TOSS_PAYMENT_ADAPTER)
    private readonly tossAdapter: PaymentGateway,
    @Inject(HMS_CARD_PAYMENT_ADAPTER)
    private readonly hmsCardAdapter: PaymentGateway,
    @Inject(HMS_BNPL_PAYMENT_ADAPTER)
    private readonly hmsBnplAdapter: PaymentGateway,
    @Inject(INTERNAL_POINT_PAYMENT_ADAPTER)
    private readonly internalPointAdapter: PaymentGateway,
  ) {
    this.initializeGatewayMappings();
  }

  /**
   * 게이트웨이 매핑 초기화 (확장성을 위한 Map 기반 구조)
   */
  private initializeGatewayMappings(): void {
    // 게이트웨이 타입별 매핑
    this.gatewayMap.set('toss', this.tossAdapter);
    this.gatewayMap.set('hms_card', this.hmsCardAdapter);
    this.gatewayMap.set('hms_bnpl', this.hmsBnplAdapter);
    this.gatewayMap.set('internal_point', this.internalPointAdapter);

    // 결제수단 타입별 게이트웨이 매핑
    this.methodTypeMap.set('CARD', 'toss');
    this.methodTypeMap.set('EASY_PAY', 'toss');
    this.methodTypeMap.set('REWARD_POINT', 'internal_point');
    this.methodTypeMap.set('BNPL', 'hms_bnpl');
  }

  /**
   * 게이트웨이 타입별 어댑터 반환 (OCP 준수 - 확장 가능한 구조)
   * @param gatewayType 결제 게이트웨이 타입
   * @returns PaymentGateway 구현체
   */
  getGateway(gatewayType: string): PaymentGateway {
    const gateway = this.gatewayMap.get(gatewayType);
    if (!gateway) {
      throw new Error(`지원하지 않는 결제 게이트웨이: ${gatewayType}`);
    }
    return gateway;
  }

  /**
   * 결제수단 타입으로 게이트웨이 자동 선택 (OCP 준수)
   * @param methodType 결제수단 타입
   * @returns PaymentGateway 구현체
   */
  getGatewayByMethodType(methodType: string): PaymentGateway {
    const gatewayType = this.methodTypeMap.get(methodType);
    if (!gatewayType) {
      throw new Error(`지원하지 않는 결제수단: ${methodType}`);
    }
    return this.getGateway(gatewayType);
  }

  /**
   * 지원하는 게이트웨이 타입 목록 조회
   */
  getSupportedGatewayTypes(): string[] {
    return Array.from(this.gatewayMap.keys());
  }

  /**
   * 지원하는 결제수단 타입 목록 조회
   */
  getSupportedMethodTypes(): string[] {
    return Array.from(this.methodTypeMap.keys());
  }
}
