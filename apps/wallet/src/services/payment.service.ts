import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentResult,
  RefundResult,
  CancelResult,
  RefundRequest,
  CancelRequest,
  PaymentType,
  ProviderType,
  PaymentError,
} from '../providers/payment-provider.interface';
import { PaymentPolicy } from '../providers/payment-policy';
import { PaymentOrchestratorService } from './payment/payment-orchestrator.service';
import { ProviderRegistry } from '../providers/provider-registry';
// ✨ [CTO 스타일] Provider별 DTO는 더 이상 PaymentService에서 알 필요 없음

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
   * 결제 승인 - Intent 기반 (새로운 방식)
   */
  async authorizePaymentByIntent(
    intentId: string,
    providerType: ProviderType,
    options: {
      profileId?: string;
      instrumentRef?: string;
      actor?: string;
      source?: string;
    } = {},
  ): Promise<PaymentResult> {
    this.logger.log(
      `Authorizing payment for intent: ${intentId} with provider: ${providerType}`,
    );

    return this.paymentOrchestrator.authorizePayment(
      intentId,
      providerType,
      options,
    );
  }

  /**
   * 결제 캡처 - Intent 기반 (새로운 방식)
   */
  async capturePaymentByIntent(
    intentId: string,
    attemptId: string,
    amount?: number,
    options: {
      actor?: string;
      source?: string;
    } = {},
  ): Promise<PaymentResult> {
    this.logger.log(
      `Capturing payment for intent: ${intentId}, attempt: ${attemptId}`,
    );

    return this.paymentOrchestrator.capturePayment(
      intentId,
      attemptId,
      amount,
      options,
    );
  }

  /**
   * 결제 처리 - Intent 기반 (레거시 호환용 - auth + capture 통합)
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
      `Processing payment (legacy) for intent: ${intentId} with provider: ${providerType}`,
    );

    // 🚫 [레거시 호환 - 더 이상 사용하지 않음] authorize + capture를 순차 실행
    // const authResult = await this.paymentOrchestrator.authorizePayment(
    //   intentId,
    //   providerType,
    //   options,
    // );

    // if (!authResult.success) {
    //   return authResult;
    // }

    // // 즉시 캡처
    // const captureResult = await this.paymentOrchestrator.capturePayment(
    //   intentId,
    //   authResult.attemptId!,
    //   undefined, // 전액 캡처
    //   options,
    // );

    // return captureResult;

    // ✅ [신규] 모든 결제는 AUTHORIZED 상태로만 처리 (정산은 별도 프로세스)
    return await this.paymentOrchestrator.authorizePayment(
      intentId,
      providerType,
      options,
    );
  }

  /**
   * 환불 처리
   * ✨ [CTO 스타일] 공통 파라미터만 받고, Provider별 DTO 조립은 각 Provider에서 담당
   */
  async refundPayment(
    providerType: ProviderType,
    request: RefundRequest,
  ): Promise<RefundResult> {
    this.logger.log(`Processing refund for provider: ${providerType}`);

    const handle = this.providerRegistry.get(providerType);
    if (!handle.refund) {
      throw new PaymentError(
        'REFUND_NOT_SUPPORTED',
        `${providerType} does not support refund functionality.`,
      );
    }

    // Provider별 클래스에서 DTO 조립 및 API 호출 담당
    return handle.refund.refund(request);
  }

  /**
   * 결제 취소
   * ✨ [CTO 스타일] 공통 파라미터만 받고, Provider별 DTO 조립은 각 Provider에서 담당
   */
  async cancelPayment(
    providerType: ProviderType,
    request: CancelRequest,
  ): Promise<CancelResult> {
    this.logger.log(`Processing cancellation for provider: ${providerType}`);

    const handle = this.providerRegistry.get(providerType);
    if (!handle.cancel) {
      throw new PaymentError(
        'CANCEL_NOT_SUPPORTED',
        `${providerType} does not support cancel functionality.`,
      );
    }

    // Provider별 클래스에서 DTO 조립 및 API 호출 담당
    return handle.cancel.cancel(request);
  }

  /**
   * 결제 타입에 허용된 Provider 목록 조회 (단순 조회 기능)
   */
  getAllowedProviders(paymentType: PaymentType): ProviderType[] {
    return PaymentPolicy.getAllowedProviders(paymentType);
  }
}
