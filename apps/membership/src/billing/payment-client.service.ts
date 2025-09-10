import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

// 결제 서버 API 타입 정의
export interface PaymentIntentRequest {
  userId: string; // 최상위 필드로 이동 (결제 서버 요구사항)
  type: 'MEMBERSHIP_FEE';
  amount: number;
  currency: string;
  description: string;
  metadata: {
    contractId: string;
    planId: string;
  };
}

export interface PaymentIntentResponse {
  intentId: string; // 결제 서버는 intentId로 반환 (id가 아님)
  type: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'PROCESSING' | 'CAPTURED' | 'FAILED';
  description: string;
  metadata: Record<string, any>;
  createdAt: string;
}

export interface PaymentAttemptRequest {
  provider: string; // 임시: 결제 서버 요구사항 (추후 서버에서 profileId 기반 자동 추론 예정)
  profileId: string; // 저장된 결제 프로필 ID (필수)
}

export interface PaymentAttemptResponse {
  attemptId: string; // 실제 응답 필드명: attemptId
  intentId: string;
  provider: string;
  status: 'PENDING' | 'PROCESSING' | 'CAPTURED' | 'FAILED';
  amount: string; // 실제 응답: 문자열 형태
  createdAt: string;
  actor: string;
  errorMessage?: string; // 실제 응답 필드명: errorMessage
  instrumentKind: string;
  transactionId: string;
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
        `Payment intent created successfully: ${response.data.intentId}`,
      );
      return response.data as PaymentIntentResponse;
    } catch (error) {
      this.logger.error(`Failed to create payment intent: ${error.message}`);
      if (error.response) {
        this.logger.error(`Response status: ${error.response.status}`);
        this.logger.error(
          `Response data: ${JSON.stringify(error.response.data)}`,
        );
      }
      throw new Error(`Payment intent creation failed: ${error.message}`);
    }
  }

  /**
   * 결제 시도 실행
   * @param intentId 결제 Intent ID
   * @param request 결제 시도 요청 데이터
   */
  async createPaymentAttempt(
    intentId: string,
    request: PaymentAttemptRequest,
  ): Promise<PaymentAttemptResponse> {
    try {
      this.logger.log(
        `Creating payment attempt for intent: ${intentId} with profile: ${request.profileId}`,
      );

      const response = await firstValueFrom(
        this.httpService.post<PaymentAttemptResponse>(
          `${this.paymentServerUrl}/v2/payments/intents/${intentId}/attempts`,
          request,
          {
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      this.logger.log(
        `Payment attempt created: ${response.data.attemptId} with status: ${response.data.status}`,
      );
      return response.data as PaymentAttemptResponse;
    } catch (error) {
      this.logger.error(
        `Failed to create payment attempt: ${error.message}`,
        error.stack,
      );
      throw new Error(`Payment attempt creation failed: ${error.message}`);
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
          `${this.paymentServerUrl}/v2/payment-profiles`,
          {
            params: { userId, isDefault: true, status: 'ACTIVE' },
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
  async getPaymentAttempt(attemptId: string): Promise<PaymentAttemptResponse> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<PaymentAttemptResponse>(
          `${this.paymentServerUrl}/v2/payments/attempts/${attemptId}`,
        ),
      );

      return response.data as PaymentAttemptResponse;
    } catch (error) {
      this.logger.error(
        `Failed to get payment attempt ${attemptId}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Payment attempt retrieval failed: ${error.message}`);
    }
  }
}
