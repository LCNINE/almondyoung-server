import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

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
    this.paymentServerUrl = this.configService.get<string>(
      'PAYMENT_SERVER_URL',
      'http://localhost:5000',
    );
  }

  /**
   * 결제 Intent 생성
   * @param request 결제 의도 요청 데이터
   */
  async createPaymentIntent(
    request: PaymentIntentRequest,
  ): Promise<PaymentIntentResponse> {
    try {
      this.logger.log(
        `Creating payment intent for contract: ${request.metadata.contractId}`,
      );
      this.logger.debug(
        `Payment intent request data: ${JSON.stringify(request)}`,
      );

      const response = await firstValueFrom(
        this.httpService.post<PaymentIntentResponse>(
          `${this.paymentServerUrl}/v2/payments/intents`,
          request,
          {
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      this.logger.log(
        `Payment intent created successfully: ${response.data.id}`,
      );
      return response.data as PaymentIntentResponse;
    } catch (error) {
      this.logger.error(`Failed to create payment intent: ${error.message}`);
      if (error.response) {
        this.logger.error(`Response status: ${error.response.status}`);
        this.logger.error(
          `Response data: ${JSON.stringify(error.response.data)}`,
        );

        // Wallet v4 특정 에러 코드 처리
        if (error.response.status === 400) {
          throw new Error(
            `Invalid payment intent request: ${error.response.data?.message || error.message}`,
          );
        } else if (error.response.status === 404) {
          throw new Error(
            `Payment endpoint not found - check Wallet server version`,
          );
        } else if (error.response.status >= 500) {
          throw new Error(`Wallet server error: ${error.response.status}`);
        }
      }

      // 네트워크 에러 처리
      if (error.code === 'ECONNREFUSED') {
        throw new Error(
          `Cannot connect to Wallet server at ${this.paymentServerUrl}`,
        );
      }

      throw new Error(`Payment intent creation failed: ${error.message}`);
    }
  }

  /**
   * 결제 실행 (Wallet v4: PaymentOrchestratorService 사용)
   * @param intentId 결제 Intent ID
   * @param request 결제 실행 요청 데이터
   */
  async processPayment(
    intentId: string,
    request: PaymentProcessRequest,
  ): Promise<PaymentProcessResponse> {
    try {
      this.logger.log(
        `Processing payment for intent: ${intentId} with provider: ${request.providerType}`,
      );

      // 디버깅: 실제 전송되는 데이터 확인
      this.logger.debug(
        `Payment process request data: ${JSON.stringify(request)}`,
      );

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
      this.logger.debug(
        `Payment process response data: ${JSON.stringify(response.data)}`,
      );

      this.logger.log(
        `Payment processed: ${response.data.transactionId} with success: ${response.data.success}`,
      );
      return response.data as PaymentProcessResponse;
    } catch (error) {
      this.logger.error(
        `Failed to process payment: ${error.message}`,
        error.stack,
      );

      if (error.response) {
        this.logger.error(
          `Payment process response status: ${error.response.status}`,
        );
        this.logger.error(
          `Payment process response data: ${JSON.stringify(error.response.data)}`,
        );

        // Wallet v4 결제 실행 특정 에러 처리
        if (error.response.status === 400) {
          throw new Error(
            `Invalid payment process request: ${error.response.data?.message || error.message}`,
          );
        } else if (error.response.status === 404) {
          throw new Error(`Payment intent not found: ${intentId}`);
        } else if (error.response.status === 409) {
          throw new Error(`Payment already processed: ${intentId}`);
        } else if (error.response.status >= 500) {
          throw new Error(
            `Wallet server error during payment processing: ${error.response.status}`,
          );
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
        this.httpService.get<PaymentProfile[]>(
          `${this.paymentServerUrl}/v2/payments/profiles/hms-card`,
          {
            params: { customerId: userId, status: 'ACTIVE' }, // Wallet v4: customerId 사용
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      const profiles = response.data as PaymentProfile[];
      if (!profiles || profiles.length === 0) {
        throw new Error(`No active payment profile found for user: ${userId}`);
      }

      const defaultProfile = profiles.find((p) => p.isDefault) || profiles[0];
      this.logger.log(
        `Found default payment profile: ${defaultProfile.id} for user: ${userId}`,
      );

      return defaultProfile;
    } catch (error) {
      this.logger.error(
        `Failed to get payment profile for user ${userId}: ${error.message}`,
        error.stack,
      );
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
        this.httpService.get<PaymentIntentResponse>(
          `${this.paymentServerUrl}/v2/payments/intents/${intentId}`,
        ),
      );

      return response.data as PaymentIntentResponse;
    } catch (error) {
      this.logger.error(
        `Failed to get payment intent ${intentId}: ${error.message}`,
        error.stack,
      );
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
        this.httpService.get<PaymentProcessResponse>(
          `${this.paymentServerUrl}/v2/payments/attempts/${attemptId}`,
        ),
      );

      return response.data as PaymentProcessResponse;
    } catch (error) {
      this.logger.error(
        `Failed to get payment attempt ${attemptId}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Payment attempt retrieval failed: ${error.message}`);
    }
  }
}
