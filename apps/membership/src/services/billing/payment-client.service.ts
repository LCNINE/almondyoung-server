import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'node:crypto';

// Wallet v4 API 타입 정의 (최신 아키텍처 반영)
export interface PaymentIntentRequest {
  customerId: string; // Wallet v4: customerId 사용 (userId가 아님)
  type: 'MEMBERSHIP_FEE'; // Wallet v4: 실제 사용하는 타입
  amount: number;
  metadata: {
    contractId: string;
    planId: string;
    billingCycle: string; // 정기결제 식별용
  };
}

export interface PaymentIntentResponse {
  id: string; // Wallet v4: 실제로는 'id' 필드 사용
  customerId: string;
  type: string;
  amount: number;
  status: 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'CANCELED';
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}
// 추후 결제서버에서 결제정책을 판단하도록 바꿀것 즉 provider없애도됨
// Wallet v4: 서버 간 결제 실행 요청 (PaymentOrchestratorService 사용)
export interface PaymentProcessRequest {
  providerType: 'HMS_CARD' | 'HMS_BNPL' | 'TOSS'; // Wallet v4에서 실제 지원하는 Provider
  profileId?: string; // HMS_CARD의 경우 필수
  instrumentRef?: string; // HMS BNPL의 경우 사용
}

// Wallet v4: 실제 결제 실행 결과 (PaymentResult 인터페이스)
export interface PaymentProcessResponse {
  success: boolean;
  transactionId?: string;
  code?: string; // 도메인 코드(성공/실패)
  message?: string; // 사용자/로그 메시지
  raw?: unknown; // 원 응답 스냅샷(옵션)
}

export interface PaymentProfile {
  id: string;
  userId: string;
  isDefault: boolean;
  provider: string;
  status: 'ACTIVE' | 'INACTIVE';
  maskedInfo: string;
  createdAt: string;
}

export interface MembershipCheckoutIntentRequest {
  userId: string;
  planId: string;
  amount: number;
  returnUrl: string;
  currency?: string;
  email?: string;
  billingMode?: 'one_time' | 'recurring';
}

export interface WalletPaymentIntentResponse {
  id: string;
  status: 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'CANCELED';
  payableAmount: number;
  createdAt: string;
  metadata: {
    type?: string;
    planId?: string;
    userId?: string;
    email?: string;
    [key: string]: unknown;
  };
}

export interface MembershipCheckoutIntentResponse {
  intentId: string;
}

// // 멤버십 서버의 스케줄러 로직 (수정 제안)

// // 1. 만료된 멤버십 조회
// const expiredContracts = await this.contractService.findExpired();

// for (const contract of expiredContracts) {
//   // 2. 결제 의도 생성
//   const intent = await this.paymentClient.createPaymentIntent({
//     customerId: contract.userId,
//     type: 'MEMBERSHIP',
//     amount: contract.plan.price,
//     metadata: { contractId: contract.id, /* ... */ },
//   });

//   // 3. ✨ 결제 실행 요청 (프로필 정보 없이 Intent ID만 전달)
//   // 결제 서버가 알아서 기본 프로필로 결제할 것을 믿고 요청만 보냅니다.
//   await this.paymentClient.executePayment(intent.id);
// }

/**
 * 결제 서버 연동 클라이언트 서비스
 * CTO 지침: PaymentIntent/PaymentAttempt 중심의 백엔드 간 결제 모델
 */
@Injectable()
export class PaymentClientService {
  private readonly logger = new Logger(PaymentClientService.name);
  private readonly paymentServerUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.paymentServerUrl = this.configService.get<string>('PAYMENT_SERVER_URL', 'http://localhost:5000');
  }

  private getWalletConfig(): { url: string; key: string } {
    const url = this.configService.get<string>('WALLET_API_URL', this.paymentServerUrl);
    const key = this.configService.get<string>('WALLET_API_KEY');
    if (!url || !key) throw new Error('WALLET_API_URL or WALLET_API_KEY is not configured');
    return { url, key };
  }

  async createMembershipCheckoutIntent(
    request: MembershipCheckoutIntentRequest,
  ): Promise<MembershipCheckoutIntentResponse> {
    const { url: walletApiUrl, key: walletApiKey } = this.getWalletConfig();

    try {
      const response = await firstValueFrom(
        this.httpService.post<{ id: string }>(
          `${walletApiUrl}/v1/payment-intents`,
          {
            userId: request.userId,
            amount: request.amount,
            currency: request.currency ?? 'KRW',
            returnUrl: request.returnUrl,
            metadata: {
              type: 'MEMBERSHIP_FEE',
              planId: request.planId,
              userId: request.userId,
              ...(request.email ? { email: request.email } : {}),
              ...(request.billingMode ? { billingMode: request.billingMode } : {}),
            },
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${walletApiKey}`,
              'Idempotency-Key': randomUUID(),
            },
          },
        ),
      );

      return { intentId: response.data.id };
    } catch (error) {
      this.logger.error(`Failed to create membership checkout intent: ${error.message}`);
      throw new Error(`Checkout intent creation failed: ${error.message}`);
    }
  }

  /**
   * Wallet v1 payment intent 상태 조회 (서버간 API key 인증)
   * confirm-checkout-intent 흐름에서 결제 검증에 사용
   */
  async getWalletPaymentIntent(intentId: string): Promise<WalletPaymentIntentResponse> {
    const { url: walletApiUrl, key: walletApiKey } = this.getWalletConfig();

    try {
      const response = await firstValueFrom(
        this.httpService.get<WalletPaymentIntentResponse>(`${walletApiUrl}/v1/payment-intents/${intentId}`, {
          headers: {
            Authorization: `Bearer ${walletApiKey}`,
          },
        }),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get wallet payment intent ${intentId}: ${error.message}`);
      if (error.response?.status === 404) {
        throw new Error(`Payment intent not found: ${intentId}`);
      }
      throw new Error(`Wallet payment intent retrieval failed: ${error.message}`);
    }
  }

  async createBillingAgreement(userId: string, contractId: string, billingMethodId?: string): Promise<void> {
    const { url: walletApiUrl, key: walletApiKey } = this.getWalletConfig();

    await firstValueFrom(
      this.httpService.post(
        `${walletApiUrl}/v1/billing-agreements`,
        {
          userId,
          subscriberRef: contractId,
          subscriberType: 'MEMBERSHIP',
          ...(billingMethodId ? { billingMethodId } : {}),
        },
        {
          headers: {
            Authorization: `Bearer ${walletApiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `membership:billing-agreement:${userId}:${contractId}`,
          },
        },
      ),
    );
  }

  async refundByIntent(
    intentId: string,
    amount: number,
    reasonCode?: string,
    reasonMessage?: string,
  ): Promise<void> {
    const { url: walletApiUrl, key: walletApiKey } = this.getWalletConfig();

    await firstValueFrom(
      this.httpService.post(
        `${walletApiUrl}/v1/payment-intents/${intentId}/refund`,
        // 멤버십 결제는 wallet 에서 환불 차단됨. 이 경로는 admin 강제취소의 정책상 예외 환불이므로
        // 차단을 우회한다 (셀프/일반 환불은 애초에 이 메서드를 호출하지 않음).
        { amount, reasonCode, reasonMessage, allowMembershipRefund: true },
        {
          headers: {
            Authorization: `Bearer ${walletApiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `membership:refund:${intentId}:${amount}`,
          },
        },
      ),
    );
  }

  async revokeBillingAgreement(contractId: string): Promise<void> {
    const { url: walletApiUrl, key: walletApiKey } = this.getWalletConfig();

    await firstValueFrom(
      this.httpService.delete(
        `${walletApiUrl}/v1/billing-agreements/by-subscriber?subscriberType=MEMBERSHIP&subscriberRef=${encodeURIComponent(contractId)}`,
        {
          headers: {
            Authorization: `Bearer ${walletApiKey}`,
            'Idempotency-Key': `membership:revoke-agreement:MEMBERSHIP:${contractId}`,
          },
        },
      ),
    );
  }

  async directCharge(params: {
    userId: string;
    billingMethodId: string;
    amount: number;
    currency?: string;
    metadata?: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<{ intentId: string; status: string }> {
    const { url: walletApiUrl, key: walletApiKey } = this.getWalletConfig();

    const idempotencyKey = params.idempotencyKey ?? `membership:direct-charge:${params.userId}:${params.billingMethodId}:${params.amount}`;

    const response = await firstValueFrom(
      this.httpService.post<{ intentId: string; status: string }>(
        `${walletApiUrl}/v1/direct-billing-charges`,
        {
          userId: params.userId,
          billingMethodId: params.billingMethodId,
          amount: params.amount,
          currency: params.currency ?? 'KRW',
          purpose: 'SUBSCRIPTION',
          metadata: params.metadata ?? {},
          idempotencyKey,
        },
        {
          headers: {
            Authorization: `Bearer ${walletApiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
        },
      ),
    );

    return response.data;
  }

  /**
   * 결제 Intent 생성
   * @param request 결제 의도 요청 데이터
   */
  async createPaymentIntent(request: PaymentIntentRequest): Promise<PaymentIntentResponse> {
    try {
      this.logger.log(`Creating payment intent for contract: ${request.metadata.contractId}`);
      this.logger.debug(`Payment intent request data: ${JSON.stringify(request)}`);

      const response = await firstValueFrom(
        this.httpService.post<PaymentIntentResponse>(`${this.paymentServerUrl}/v2/payments/intents`, request, {
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );

      this.logger.log(`Payment intent created successfully: ${response.data.id}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to create payment intent: ${error.message}`);
      if (error.response) {
        this.logger.error(`Response status: ${error.response.status}`);
        this.logger.error(`Response data: ${JSON.stringify(error.response.data)}`);

        // Wallet v4 특정 에러 코드 처리
        if (error.response.status === 400) {
          throw new Error(`Invalid payment intent request: ${error.response.data?.message || error.message}`);
        } else if (error.response.status === 404) {
          throw new Error(`Payment endpoint not found - check Wallet server version`);
        } else if (error.response.status >= 500) {
          throw new Error(`Wallet server error: ${error.response.status}`);
        }
      }

      // 네트워크 에러 처리
      if (error.code === 'ECONNREFUSED') {
        throw new Error(`Cannot connect to Wallet server at ${this.paymentServerUrl}`);
      }

      throw new Error(`Payment intent creation failed: ${error.message}`);
    }
  }

  /**
   * 결제 실행 (Wallet v4: PaymentOrchestratorService 사용)
   * @param intentId 결제 Intent ID
   * @param request 결제 실행 요청 데이터
   */
  async processPayment(intentId: string, request: PaymentProcessRequest): Promise<PaymentProcessResponse> {
    try {
      this.logger.log(`Processing payment for intent: ${intentId} with provider: ${request.providerType}`);

      // 디버깅: 실제 전송되는 데이터 확인
      this.logger.debug(`Payment process request data: ${JSON.stringify(request)}`);

      const response = await firstValueFrom(
        this.httpService.post<PaymentProcessResponse>(
          `${this.paymentServerUrl}/v2/payments/intents/${intentId}/process`,
          request,
          {
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      // 디버깅: 실제 응답 데이터 확인
      this.logger.debug(`Payment process response data: ${JSON.stringify(response.data)}`);

      this.logger.log(`Payment processed: ${response.data.transactionId} with success: ${response.data.success}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to process payment: ${error.message}`, error.stack);

      if (error.response) {
        this.logger.error(`Payment process response status: ${error.response.status}`);
        this.logger.error(`Payment process response data: ${JSON.stringify(error.response.data)}`);

        // Wallet v4 결제 실행 특정 에러 처리
        if (error.response.status === 400) {
          throw new Error(`Invalid payment process request: ${error.response.data?.message || error.message}`);
        } else if (error.response.status === 404) {
          throw new Error(`Payment intent not found: ${intentId}`);
        } else if (error.response.status === 409) {
          throw new Error(`Payment already processed: ${intentId}`);
        } else if (error.response.status >= 500) {
          throw new Error(`Wallet server error during payment processing: ${error.response.status}`);
        }
      }

      throw new Error(`Payment processing failed: ${error.message}`);
    }
  }

  /**
   * 사용자의 기본 결제 프로필 조회
   * @param userId 사용자 ID
   */
  async getDefaultPaymentProfile(userId: string): Promise<PaymentProfile> {
    try {
      this.logger.log(`Getting default payment profile for user: ${userId}`);

      const response = await firstValueFrom(
        this.httpService.get<PaymentProfile[]>(`${this.paymentServerUrl}/v2/payments/profiles/hms-card`, {
          params: { customerId: userId, status: 'ACTIVE' }, // Wallet v4: customerId 사용
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );

      const profiles = response.data;
      if (!profiles || profiles.length === 0) {
        throw new Error(`No active payment profile found for user: ${userId}`);
      }

      const defaultProfile = profiles.find((p) => p.isDefault) || profiles[0];
      this.logger.log(`Found default payment profile: ${defaultProfile.id} for user: ${userId}`);

      return defaultProfile;
    } catch (error) {
      this.logger.error(`Failed to get payment profile for user ${userId}: ${error.message}`, error.stack);
      throw new Error(`Payment profile retrieval failed: ${error.message}`);
    }
  }

  /**
   * 결제 Intent 상태 조회
   * @param intentId 결제 Intent ID
   */
  async getPaymentIntent(intentId: string): Promise<PaymentIntentResponse> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<PaymentIntentResponse>(`${this.paymentServerUrl}/v2/payments/intents/${intentId}`),
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get payment intent ${intentId}: ${error.message}`, error.stack);
      throw new Error(`Payment intent retrieval failed: ${error.message}`);
    }
  }

  /**
   * 결제 Attempt 상태 조회
   * @param attemptId 결제 Attempt ID
   */
  async getPaymentAttempt(attemptId: string): Promise<PaymentProcessResponse> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<PaymentProcessResponse>(`${this.paymentServerUrl}/v2/payments/attempts/${attemptId}`),
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get payment attempt ${attemptId}: ${error.message}`, error.stack);
      throw new Error(`Payment attempt retrieval failed: ${error.message}`);
    }
  }
}
