import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentResult,
  RefundResult,
  CancelResult,
  PaymentType,
  ProviderType,
  // ✨ [변경] RefundRequest, CancelRequest 등 거대 인터페이스는 더 이상 사용하지 않습니다.
} from '../providers/payment-provider.interface';
import { PaymentPolicy } from '../providers/payment-policy';
import { PaymentOrchestratorService } from './payment/payment-orchestrator.service';
import { ProviderRegistry } from '../providers/provider-registry';
import {
  HmsCancelPayload,
  HmsRefundPayload,
} from '../providers/hms-card.refund';
import { TossRefundPayload } from '../providers/toss.refund';

/**
 * [리팩토링 완료] PaymentService - 최상위 통합 레이어 (Public Facade)
 *
 * 책임:
 * - 결제 모듈의 공식 API 엔드포인트 역할
 * - 외부 세계에 단순하고 일관된 인터페이스 제공
 * - 내부의 복잡한 서비스(Orchestrator, Registry 등)를 조합하여 기능 수행
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly providerRegistry: ProviderRegistry,
    private readonly paymentOrchestrator: PaymentOrchestratorService,
  ) {}

  /**
   * 결제 처리 - Intent 기반 (주력 결제 방식)
   */
  async processPaymentByIntent(
    intentId: string,
    providerType: ProviderType, // ✨ providerType을 매개변수로 추가
    options: {
      profileId?: string;
      instrumentRef?: string;
      actor?: string;
      source?: string;
    } = {},
  ): Promise<PaymentResult> {
    this.logger.log(
      `Processing payment for intent: ${intentId} with provider: ${providerType}`,
    );

    // ✨ [수정] 전달받은 providerType 값을 Orchestrator에게 그대로 넘겨줍니다.
    return this.paymentOrchestrator.executePayment(
      intentId,
      providerType,
      options,
    );
  }

  /**
   * 환불 처리
   * ✨ [변경] 범용 RefundRequest 대신, 환불에 필요한 최소한의 정보를 받습니다.
   */
  async refundPayment(
    providerType: ProviderType,
    payload: {
      transactionId?: string; // HMS 등에서 사용하는 원거래 ID
      paymentKey?: string; // Toss 등에서 사용하는 원거래 키
      reason: string;
      amount?: number; // 부분 환불 금액
    },
  ): Promise<RefundResult> {
    this.logger.log(`Processing refund for provider: ${providerType}`);

    const handle = this.providerRegistry.get(providerType);
    if (!handle.refund) {
      throw new Error(`${providerType} does not support refund functionality.`);
    }

    // ✨ [변경] Provider 타입에 맞는 전용 Payload를 여기서 직접 만들어 전달합니다.
    let providerPayload: HmsRefundPayload | TossRefundPayload;

    if (
      providerType === ProviderType.HMS_CARD ||
      providerType === ProviderType.HMS_BNPL
    ) {
      if (!payload.transactionId || !payload.amount) {
        throw new Error('HMS refund requires transactionId and amount.');
      }
      providerPayload = {
        transactionId: payload.transactionId,
        amount: payload.amount,
        reason: payload.reason,
      };
    } else if (providerType === ProviderType.TOSS) {
      if (!payload.paymentKey) {
        throw new Error('Toss refund requires a paymentKey.');
      }
      providerPayload = {
        paymentKey: payload.paymentKey,
        reason: payload.reason,
        cancelAmount: payload.amount,
      };
    } else {
      throw new Error(`Refund logic not implemented for ${providerType}`);
    }

    // ✨ [수정] Port 객체 내부의 실제 메서드를 호출합니다.
    return handle.refund.refund(providerPayload);
  }

  /**
   * 결제 취소
   * ✨ [변경] 범용 CancelRequest 대신, 취소에 필요한 최소한의 정보를 받습니다.
   */
  async cancelPayment(
    providerType: ProviderType,
    payload: {
      transactionId?: string; // HMS 등에서 사용하는 원거래 ID
      paymentKey?: string; // Toss 등에서 사용하는 원거래 키
      reason: string;
    },
  ): Promise<CancelResult> {
    this.logger.log(`Processing cancellation for provider: ${providerType}`);

    const handle = this.providerRegistry.get(providerType);
    if (!handle.cancel) {
      throw new Error(`${providerType} does not support cancel functionality.`);
    }

    // ✨ [변경] Provider 타입에 맞는 전용 Payload를 만들어 전달합니다.
    let providerPayload:
      | HmsCancelPayload
      | { paymentKey: string; reason: string };

    if (
      providerType === ProviderType.HMS_CARD ||
      providerType === ProviderType.HMS_BNPL
    ) {
      if (!payload.transactionId)
        throw new Error('HMS cancel requires transactionId.');
      providerPayload = {
        transactionId: payload.transactionId,
        reason: payload.reason,
      };
    } else if (providerType === ProviderType.TOSS) {
      if (!payload.paymentKey)
        throw new Error('Toss cancel requires a paymentKey.');
      providerPayload = {
        paymentKey: payload.paymentKey,
        reason: payload.reason,
      };
    } else {
      throw new Error(`Cancel logic not implemented for ${providerType}`);
    }

    // ✨ [수정] Port 객체 내부의 실제 메서드를 호출합니다.
    return handle.cancel.cancel(providerPayload);
  }

  /**
   * 결제 타입에 허용된 Provider 목록 조회 (단순 조회 기능)
   */
  getAllowedProviders(paymentType: PaymentType): ProviderType[] {
    return PaymentPolicy.getAllowedProviders(paymentType);
  }
}
