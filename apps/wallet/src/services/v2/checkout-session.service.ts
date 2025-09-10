// services/v2/checkout-session.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import { DbService } from '@app/db';
import * as schema from '../../shared/database/schema';
import {
  CheckoutSessionCreateDto,
  CheckoutSessionResponseDto,
  CheckoutSessionCallbackDto,
} from '../../shared/dtos/checkout-session.dto';
import {
  UniversalCheckoutSessionCreateDto,
  UniversalCheckoutSessionResponseDto,
} from '../../shared/dtos/universal-checkout.dto';
import { PaymentIntentService } from './payment-intent.service';
import { PaymentPolicyValidator } from '../../shared/policies/payment-policy';

/**
 * CheckoutSession v2 Service
 *
 * 책임:
 * - 웹 리다이렉트 결제창 UX 세션 관리
 * - PG사 콜백 처리 및 Intent/Attempt 자동 연동
 * - 세션 상태 관리 (PENDING → COMPLETED/CANCELLED/EXPIRED)
 * - PG사별 리다이렉트 URL 생성
 */
@Injectable()
export class CheckoutSessionService {
  private readonly logger = new Logger(CheckoutSessionService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly paymentIntentService: PaymentIntentService,
    private readonly policyValidator: PaymentPolicyValidator,
  ) {}

  /**
   * CheckoutSession 생성 (CTO 의도: provider 없음, UX 컨테이너만)
   */
  async createSession(
    dto: CheckoutSessionCreateDto,
  ): Promise<CheckoutSessionResponseDto> {
    this.logger.log(`CheckoutSession 생성 시작: intentId=${dto.intentId}`);

    return await this.dbService.db.transaction(async (tx) => {
      // 1. Intent 존재 확인
      const intents = await tx
        .select()
        .from(schema.paymentIntents)
        .where(eq(schema.paymentIntents.id, dto.intentId))
        .limit(1);

      if (intents.length === 0) {
        throw new Error(`Intent not found: ${dto.intentId}`);
      }

      const intent = intents[0];

      // 2. Intent 상태 검증
      if (intent.status !== 'PENDING') {
        throw new Error(`Intent already processed: ${intent.status}`);
      }

      if (new Date() > intent.expiresAt) {
        throw new Error('Intent expired');
      }

      // 3. CheckoutSession 생성 (provider 없음)
      const sessionId = `cs_${ulid()}`;
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15분

      await tx.insert(schema.checkoutSessions).values({
        id: sessionId,
        intentId: dto.intentId,
        redirectUrl: dto.redirectUrl,
        returnUrl: dto.returnUrl,
        cancelUrl: dto.cancelUrl,
        status: 'PENDING',
        expiresAt,
        metadata: dto.metadata ? JSON.stringify(dto.metadata) : null,
      });

      // 4. 결제창 URL 생성 (우리 호스트 결제 UI)
      const checkoutUrl = this.generateUniversalCheckoutUrl(
        sessionId,
        intent.amount,
        dto.metadata,
      );

      const response: CheckoutSessionResponseDto = {
        sessionId,
        intentId: dto.intentId,
        status: 'PENDING',
        checkoutUrl,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        metadata: dto.metadata,
      };

      this.logger.log(`CheckoutSession 생성 완료: ${sessionId}`);
      return response;
    });
  }

  // ===============================
  // v5 아키텍처: Universal Checkout Session
  // ===============================

  /**
   * Universal Checkout Session 생성 (v5 아키텍처)
   * intentId만 받아서 UI 렌더링에 필요한 모든 데이터 제공
   */
  async createUniversalSession(
    dto: UniversalCheckoutSessionCreateDto,
  ): Promise<UniversalCheckoutSessionResponseDto> {
    this.logger.log(
      `Universal Checkout Session 생성 시작: intentId=${dto.intentId}`,
    );

    // 🔧 임시: 트랜잭션 없이 실행 (Drizzle 트랜잭션 이슈 우회)
    const db = this.dbService.db;

    try {
      // 1. Intent 조회 및 검증
      const intents = await db
        .select()
        .from(schema.paymentIntents)
        .where(eq(schema.paymentIntents.id, dto.intentId))
        .limit(1);

      if (intents.length === 0) {
        throw new Error(`Intent not found: ${dto.intentId}`);
      }

      const intent = intents[0];

      // 2. Intent 상태 검증
      if (intent.status !== 'PENDING') {
        throw new Error(`Intent already processed: ${intent.status}`);
      }

      if (new Date() > intent.expiresAt) {
        throw new Error('Intent expired');
      }

      // 3. (삭제됨: allowedProviders는 런타임에 계산)

      // 4. CheckoutSession 생성 (기본값 활용)
      const sessionId = ulid();
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30분

      // 🔧 다시 Drizzle ORM 방식으로 시도 (최소 필드만)
      await db.insert(schema.checkoutSessions).values({
        id: sessionId,
        intentId: dto.intentId,
        redirectUrl: 'http://localhost:3000/payment-success.html',
        returnUrl: 'http://localhost:3000/payment-success.html',
        cancelUrl: 'http://localhost:3000/payment-fail.html',
        status: 'PENDING', // 추가
        expiresAt,
        metadata: JSON.stringify({
          type: 'universal',
        }),
      });
      // 5. Provider별 UI 설정 데이터 생성 (런타임 계산)
      const allowedProviders = this.policyValidator.getAvailableProviders(
        intent.type,
      );
      const providers = await this.generateProviderConfigs(
        allowedProviders,
        intent.customerId,
      );

      // 6. Intent 정보 구성
      const intentInfo = {
        id: intent.id,
        amount: intent.amount,
        currency: 'KRW', // 한국 전용
        orderName: this.extractOrderName(intent.metadata),
        allowedProviders,
      };

      const response: UniversalCheckoutSessionResponseDto = {
        sessionId,
        intent: intentInfo,
        providers,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
      };

      this.logger.log(
        `Universal Checkout Session 생성 완료: ${sessionId}, providers: ${allowedProviders.join(', ')}`,
      );

      return response;
    } catch (error) {
      // PostgreSQL 에러 상세 정보 출력
      this.logger.error('전체 에러 객체:', JSON.stringify(error, null, 2));
      this.logger.error(`에러 메시지: ${error.message}`);

      if (error.code) {
        this.logger.error(`PostgreSQL 에러 코드: ${error.code}`);
        this.logger.error(`에러 상세: ${error.detail}`);
        this.logger.error(`에러 힌트: ${error.hint}`);
        this.logger.error(`에러 테이블: ${error.table}`);
        this.logger.error(`에러 제약조건: ${error.constraint}`);
      }

      // 스택 트레이스
      this.logger.error('스택:', error.stack);

      // 원본 에러 그대로 throw
      throw error;
    }
  }

  /**
   * Provider별 UI 설정 데이터 생성
   */
  private async generateProviderConfigs(
    allowedProviders: string[],
    customerId: string,
  ): Promise<Record<string, any>> {
    const providers: Record<string, any> = {};

    for (const providerId of allowedProviders) {
      switch (providerId) {
        case 'TOSS':
          providers[providerId] = {
            flow: 'REDIRECT',
            config: {
              clientKey:
                process.env.TOSS_CLIENT_KEY ||
                'test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eoq',
            },
          };
          break;

        case 'POINTS':
          // 포인트 잔액 조회 (실제로는 포인트 서비스 호출)
          const pointBalance = await this.getPointBalance(customerId);
          providers[providerId] = {
            flow: 'INLINE',
            config: {
              available: pointBalance,
            },
          };
          break;

        case 'BNPL':
          // BNPL 한도 조회 (실제로는 BNPL 서비스 호출)
          const bnplLimit = await this.getBnplLimit(customerId);
          providers[providerId] = {
            flow: 'INLINE',
            config: {
              limit: bnplLimit,
            },
          };
          break;

        case 'KAKAOPAY':
          providers[providerId] = {
            flow: 'REDIRECT',
            config: {
              // 카카오페이 설정값들
            },
          };
          break;

        default:
          this.logger.warn(`Unknown provider: ${providerId}`);
          providers[providerId] = {
            flow: 'INLINE',
            config: {},
          };
      }
    }

    return providers;
  }

  /**
   * Intent metadata에서 orderName 추출
   */
  private extractOrderName(metadata: string | null): string {
    if (!metadata) return '결제';

    try {
      const parsed = JSON.parse(metadata);
      return parsed.orderName || parsed.itemName || '결제';
    } catch {
      return '결제';
    }
  }

  /**
   * 포인트 잔액 조회 (Mock 구현)
   */
  private async getPointBalance(customerId: string): Promise<number> {
    // TODO: 실제 포인트 서비스 연동
    this.logger.log(`포인트 잔액 조회: customerId=${customerId}`);
    return 1500; // Mock 데이터
  }

  /**
   * BNPL 한도 조회 (Mock 구현)
   */
  private async getBnplLimit(customerId: string): Promise<number> {
    // TODO: 실제 BNPL 서비스 연동
    this.logger.log(`BNPL 한도 조회: customerId=${customerId}`);
    return 100000; // Mock 데이터
  }

  /**
   * CheckoutSession 조회
   */
  async getSession(sessionId: string): Promise<CheckoutSessionResponseDto> {
    const sessions = await this.dbService.db
      .select()
      .from(schema.checkoutSessions)
      .where(eq(schema.checkoutSessions.id, sessionId))
      .limit(1);

    if (sessions.length === 0) {
      throw new Error(`CheckoutSession not found: ${sessionId}`);
    }

    const session = sessions[0];

    return {
      sessionId: session.id,
      intentId: session.intentId,
      status: session.status,
      checkoutUrl: this.generateUniversalCheckoutUrl(
        sessionId,
        0, // 금액은 Intent에서 가져와야 하지만 일단 0
        session.metadata ? JSON.parse(session.metadata) : undefined,
      ),
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      // completedAt: session.completedAt?.toISOString(),
      metadata: session.metadata ? JSON.parse(session.metadata) : undefined,
    };
  }

  /**
   * PG사 콜백 처리
   */
  async handleCallback(
    sessionId: string,
    dto: CheckoutSessionCallbackDto,
  ): Promise<CheckoutSessionResponseDto> {
    this.logger.log(
      `PG사 콜백 처리 시작: sessionId=${sessionId}, status=${dto.status}`,
    );

    return await this.dbService.db.transaction(async (tx) => {
      // 1. CheckoutSession 조회
      const sessions = await tx
        .select()
        .from(schema.checkoutSessions)
        .where(eq(schema.checkoutSessions.id, sessionId))
        .limit(1);

      if (sessions.length === 0) {
        throw new Error(`CheckoutSession not found: ${sessionId}`);
      }

      const session = sessions[0];

      // 2. 세션 상태 검증
      if (session.status !== 'PENDING') {
        throw new Error(`CheckoutSession already processed: ${session.status}`);
      }

      // 3. 세션 상태 업데이트
      const newStatus =
        dto.status === 'SUCCESS'
          ? 'COMPLETED'
          : dto.status === 'CANCEL'
            ? 'CANCELLED'
            : 'COMPLETED';

      await tx
        .update(schema.checkoutSessions)
        .set({
          status: newStatus as any,
          // completedAt: new Date(),
          createdAt: new Date(),
          expiresAt: new Date(),
          metadata: JSON.stringify({
            ...(session.metadata ? JSON.parse(session.metadata) : {}),
            callback: dto,
          }),
        })
        .where(eq(schema.checkoutSessions.id, sessionId));

      // 4. 결제 성공 시 Intent/Attempt 자동 생성
      if (dto.status === 'SUCCESS') {
        await this.createAutomaticAttempt(session, dto, tx);
      }

      this.logger.log(`콜백 처리 완료: ${sessionId} → ${newStatus}`);

      return await this.getSession(sessionId);
    });
  }

  /**
   * CheckoutSession 취소
   */
  async cancelSession(sessionId: string): Promise<CheckoutSessionResponseDto> {
    await this.dbService.db
      .update(schema.checkoutSessions)
      .set({
        status: 'CANCELLED',
        // completedAt: new Date(),
      })
      .where(eq(schema.checkoutSessions.id, sessionId));

    return await this.getSession(sessionId);
  }

  /**
   * Universal 결제창 URL 생성 (CTO 의도: provider 선택은 UI에서)
   */
  private generateUniversalCheckoutUrl(
    sessionId: string,
    amount: number,
    metadata?: any,
  ): string {
    const baseUrl =
      process.env.CHECKOUT_BASE_URL || 'https://checkout.example.com';

    // 우리 호스트 결제 UI로 리다이렉트 (provider 선택은 UI에서)
    return `${baseUrl}/session/${sessionId}?amount=${amount}`;
  }

  /**
   * 콜백 성공 시 자동 Attempt 생성
   */
  private async createAutomaticAttempt(
    session: any,
    callback: CheckoutSessionCallbackDto,
    tx: any,
  ): Promise<void> {
    this.logger.log(`자동 Attempt 생성: intentId=${session.intentId}`);

    // 콜백 데이터에서 provider 추론
    const provider = this.inferProviderFromCallback(callback);

    try {
      // PaymentIntentService를 통해 Attempt 생성
      // 단, 트랜잭션 내부이므로 직접 DB 조작이 필요할 수 있음

      // 임시: Attempt 레코드 직접 생성 (실제로는 PaymentIntentService 사용)
      const attemptId = `pa_${ulid()}`;

      await tx.insert(schema.paymentAttempts).values({
        id: attemptId,
        intentId: session.intentId,
        provider,
        instrumentRef: callback.pgTransactionId || callback.approvalNumber,
        status: callback.status === 'SUCCESS' ? 'CAPTURED' : 'FAILED',
        amount: callback.actualAmount || 0,
        transactionId: callback.pgTransactionId,
        eventContext: JSON.stringify({
          pg: {
            gateway: provider,
            transactionId: callback.pgTransactionId,
            approvalNumber: callback.approvalNumber,
          },
          business: {
            source: 'checkout_session',
            sessionId: session.id,
          },
        }),
      });

      this.logger.log(`자동 Attempt 생성 완료: ${attemptId}`);
    } catch (error) {
      this.logger.error(`자동 Attempt 생성 실패`, error);
      // 콜백 처리는 성공하되, Attempt 생성 실패는 별도 처리
    }
  }

  /**
   * 콜백 데이터에서 provider 추론
   */
  private inferProviderFromCallback(callback: CheckoutSessionCallbackDto): any {
    // 콜백 데이터 패턴으로 provider 결정
    if (callback.approvalNumber?.startsWith('kakao_')) {
      return 'KAKAOPAY';
    }
    if (callback.pgTransactionId?.startsWith('toss_')) {
      return 'TOSS';
    }
    if (callback.approvalNumber?.startsWith('cms_')) {
      return 'CMS';
    }

    // 기본값
    return 'TOSS';
  }
}
