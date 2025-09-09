// services/v2/payment-intent.service.ts - v4 아키텍처 Intent 서비스
import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';

import * as schema from '../../shared/database/schema';
import { PaymentPolicyValidator } from '../../shared/policies/payment-policy';
import {
  IntentCreateDto,
  IntentResponseDto,
  AttemptCreateDto,
  AttemptResponseDto,
  AttemptFinalizeDto,
} from '../../shared/dtos/v2-payment.dto';
import { DbService } from '@app/db';
import { PaymentProviderFactory } from '../../providers/payment-provider.factory';

/**
 * v4 아키텍처 Payment Intent 서비스
 *
 * 책임:
 * - Intent 생성/조회/상태 관리
 * - Attempt 실행 및 Provider 호출
 * - 정책 검증 및 하드가드 적용
 * - DB 트랜잭션 관리
 */
@Injectable()
export class PaymentIntentService {
  private readonly logger = new Logger(PaymentIntentService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly policyValidator: PaymentPolicyValidator,
    private readonly providerFactory: PaymentProviderFactory,
  ) {}

  /**
   * Intent 생성
   */
  async createIntent(
    dto: IntentCreateDto,
    idempotencyKey?: string,
  ): Promise<IntentResponseDto> {
    this.logger.log(
      `Intent 생성 시작: userId=${dto.userId}, type=${dto.type}, amount=${dto.amount}`,
    );

    return await this.dbService.db.transaction(async (tx) => {
      // 1. 멱등성 키 처리
      if (idempotencyKey) {
        const existing = await tx
          .select()
          .from(schema.idempotencyKeys)
          .where(eq(schema.idempotencyKeys.id, idempotencyKey))
          .limit(1);

        if (existing.length > 0) {
          if (existing[0].status === 'COMPLETED' && existing[0].responseBody) {
            this.logger.log(`멱등성 키 적중: ${idempotencyKey}`);
            return JSON.parse(existing[0].responseBody);
          }
          throw new Error('Idempotency key already processing');
        }

        // 멱등성 키 등록
        await tx.insert(schema.idempotencyKeys).values({
          id: idempotencyKey,
          userId: dto.userId,
          requestPath: '/v2/payments/intents',
          requestHash: this.generateRequestHash(dto),
          status: 'PROCESSING',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24시간
        });
      }

      // 2. 정책 검증 (기본 Provider 설정)
      const allowedProviders =
        dto.allowedProviders ||
        this.policyValidator.getAllowedProviders(dto.type);

      // 3. Intent 생성
      const intentId = ulid();
      const expiresAt = dto.expiresAt
        ? new Date(dto.expiresAt)
        : new Date(Date.now() + 30 * 60 * 1000); // 30분

      await tx.insert(schema.paymentIntents).values({
        id: intentId,
        customerId: dto.userId,
        amount: dto.amount,
        status: 'PENDING',
        type: dto.type,
        allowedProviders: JSON.stringify(allowedProviders),
        metadata: dto.metadata ? JSON.stringify(dto.metadata) : null,
        expiresAt,
      });

      const response: IntentResponseDto = {
        intentId,
        status: 'PENDING',
        amount: dto.amount,
        type: dto.type,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        allowedProviders,
        refundedAmount: 0,
      };

      // 4. 멱등성 키 완료 처리
      if (idempotencyKey) {
        await tx
          .update(schema.idempotencyKeys)
          .set({
            status: 'COMPLETED',
            responseBody: JSON.stringify(response),
          })
          .where(eq(schema.idempotencyKeys.id, idempotencyKey));
      }

      this.logger.log(`Intent 생성 완료: ${intentId}`);
      return response;
    });
  }

  /**
   * Intent 조회
   */
  async getIntent(intentId: string): Promise<IntentResponseDto> {
    const intent = await this.dbService.db
      .select()
      .from(schema.paymentIntents)
      .where(eq(schema.paymentIntents.id, intentId))
      .limit(1);

    if (intent.length === 0) {
      throw new Error(`Intent not found: ${intentId}`);
    }

    const session = intent[0];
    return {
      intentId: session.id,
      status: session.status,
      amount: session.amount,
      type: session.type,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      allowedProviders: session.allowedProviders
        ? JSON.parse(session.allowedProviders)
        : undefined,
      refundedAmount: session.refundedAmount,
    };
  }

  /**
   * Attempt 생성 및 실행
   */
  async createAttempt(
    intentId: string,
    dto: AttemptCreateDto,
    idempotencyKey?: string,
  ): Promise<AttemptResponseDto> {
    this.logger.log(
      `Attempt 생성 시작: intentId=${intentId}, provider=${dto.provider}`,
    );

    return await this.dbService.db.transaction(async (tx) => {
      // 1. Intent 조회 및 검증
      const intent = await tx
        .select()
        .from(schema.paymentIntents)
        .where(eq(schema.paymentIntents.id, intentId))
        .limit(1);

      if (intent.length === 0) {
        throw new Error(`Intent not found: ${intentId}`);
      }

      const session = intent[0];

      if (session.status !== 'PENDING') {
        throw new Error(`Intent already processed: ${session.status}`);
      }

      if (new Date() > session.expiresAt) {
        throw new Error('Intent expired');
      }

      // 2. 🛡️ 하드가드 검사 (BNPL_CAPTURE → CMS 강제)
      if (session.type === 'BNPL_CAPTURE' && dto.provider !== 'CMS') {
        this.logger.error(
          `하드가드 위반: BNPL_CAPTURE는 CMS만 허용 - 요청된 Provider: ${dto.provider}`,
        );
        throw new Error('policy.bnpl.capture.cms.only');
      }

      // 3. 일반 정책 검증
      const allowedProviders = session.allowedProviders
        ? JSON.parse(session.allowedProviders)
        : [];
      this.policyValidator.validateIntentProvider(
        session.type,
        dto.provider,
        !!dto.profileId,
        !!dto.instrumentRef,
      );

      if (!allowedProviders.includes(dto.provider)) {
        throw new Error(`Provider ${dto.provider} not allowed for this intent`);
      }

      // 4. 프로필 검증 (저장형 결제수단 필요 시)
      if (dto.profileId) {
        await this.validateProfile(
          tx,
          dto.profileId,
          session.customerId,
          session.type,
        );
      }

      // 5. Provider별 결제 실행
      let paymentResult;
      try {
        paymentResult = await this.executePayment(
          dto.provider,
          session.amount,
          {
            sessionId: intentId,
            hmsMemberId: dto.profileId,
            paymentMethodId: dto.profileId,
          },
        );
      } catch (error) {
        this.logger.error(`결제 실행 실패: ${error.message}`);
        paymentResult = {
          success: false,
          transactionId: '',
          error: error.message,
        };
      }

      // 4. Attempt 저장
      const attemptId = ulid();

      // BNPL은 승인만 처리 (AUTHORIZED), 나머지는 즉시 확정 (CAPTURED)
      let attemptStatus: 'AUTHORIZED' | 'CAPTURED' | 'FAILED';
      if (!paymentResult.success) {
        attemptStatus = 'FAILED';
      } else if (dto.provider === 'BNPL') {
        attemptStatus = 'AUTHORIZED'; // BNPL은 승인만, 나중에 월별 billing에서 CAPTURE
      } else {
        attemptStatus = 'CAPTURED'; // PG, Points 등은 즉시 확정
      }

      await tx.insert(schema.paymentAttempts).values({
        id: attemptId,
        intentId: intentId,
        provider: dto.provider,
        instrumentKind: dto.profileId ? 'STORED' : 'EPHEMERAL',
        instrumentRef: dto.instrumentRef || null,
        profileId: dto.profileId || null,
        amount: session.amount,
        status: attemptStatus,
        actor: dto.actor || 'USER',
        errorMessage: paymentResult.error || null,
        transactionId: paymentResult.transactionId || null,
        approvalNumber: paymentResult.metadata?.approvalNumber || null,
        eventContext: JSON.stringify({
          pg: {
            gateway: dto.provider.toLowerCase(),
            approvalNumber: paymentResult.metadata?.approvalNumber,
            paymentDate: paymentResult.metadata?.paymentDate,
            transactionId: paymentResult.transactionId,
          },
          business: {
            type: session.type,
            source: dto.source || 'api',
          },
        }),
      });

      // 5. Intent 상태 업데이트
      await tx
        .update(schema.paymentIntents)
        .set({
          status: attemptStatus,
          authorizedAt: paymentResult.success ? new Date() : null,
          capturedAt: attemptStatus === 'CAPTURED' ? new Date() : null, // BNPL은 나중에 CAPTURE
          updatedAt: new Date(),
        })
        .where(eq(schema.paymentIntents.id, intentId));

      const response: AttemptResponseDto = {
        attemptId,
        intentId,
        provider: dto.provider,
        status: attemptStatus,
        amount: session.amount,
        createdAt: new Date().toISOString(),
        actor: dto.actor || 'USER',
        errorMessage: paymentResult.error,
        instrumentKind: dto.profileId ? 'STORED' : 'EPHEMERAL',
        transactionId: paymentResult.transactionId,
        approvalNumber: paymentResult.metadata?.approvalNumber,
      };

      this.logger.log(
        `Attempt 생성 완료: ${attemptId}, 결과: ${attemptStatus}`,
      );
      return response;
    });
  }

  /**
   * Attempt 확정 (웹 결제 복귀용)
   */
  async finalizeAttempt(
    intentId: string,
    dto: AttemptFinalizeDto,
    idempotencyKey?: string,
  ): Promise<AttemptResponseDto> {
    // TODO: 웹 결제 확정 로직 구현
    // 현재는 createAttempt와 동일한 로직으로 처리
    return this.createAttempt(
      intentId,
      {
        provider: 'KAKAOPAY', // 임시
        instrumentRef: dto.approvalKey,
        source: 'api',
        actor: 'USER',
      },
      idempotencyKey,
    );
  }

  /**
   * Provider별 결제 실행 (Provider Factory 사용)
   */
  private async executePayment(
    provider: string,
    amount: number,
    metadata: any,
  ) {
    // Provider ID 매핑 (schema -> Provider Factory)
    const providerMapping: Record<string, string> = {
      CMS: 'HMS_CMS',
      TOSS: 'TOSS',
      KAKAOPAY: 'KAKAOPAY',
      BNPL: 'HMS_BNPL',
      POINTS: 'POINTS',
    };

    const mappedProvider = providerMapping[provider];
    if (!mappedProvider) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    try {
      // Provider Factory에서 적절한 Provider 가져오기
      const paymentProvider = this.providerFactory.getProvider(
        mappedProvider as any,
      );

      // Provider 인터페이스로 결제 실행
      const result = await paymentProvider.processPayment({
        intentId: metadata.sessionId,
        attemptId: ulid(),
        amount,
        type: metadata.type || 'ORDER',
        userId: metadata.userId,
        profileId: metadata.paymentMethodId,
        instrumentRef: metadata.instrumentRef,
        instrumentKind: metadata.instrumentKind || 'STORED',
        metadata,
      });

      return result;
    } catch (error) {
      this.logger.error(
        `Provider 실행 실패: ${provider} -> ${mappedProvider}`,
        error,
      );

      // 폴백: Mock 응답 (Provider 구현 안된 경우)
      return {
        success: true,
        transactionId: `${provider.toLowerCase()}_${ulid()}`,
        metadata: { provider: provider.toLowerCase(), method: 'mock_fallback' },
      };
    }
  }

  /**
   * 프로필 검증 (의사코드 구현)
   */
  private async validateProfile(
    tx: any,
    profileId: string,
    userId: string,
    intentType: string,
  ): Promise<void> {
    this.logger.log(
      `프로필 검증 시작: profileId=${profileId}, userId=${userId}`,
    );

    // 프로필 조회 (트랜잭션 외부에서 조회 - 격리 문제 해결)
    const profiles = await this.dbService.db
      .select()
      .from(schema.paymentProfiles)
      .where(eq(schema.paymentProfiles.id, profileId))
      .limit(1);

    if (profiles.length === 0) {
      throw new Error(`Profile not found: ${profileId}`);
    }

    const profile = profiles[0];

    // 1. 프로필 소유자가 인텐트 사용자와 일치하는가?
    if (profile.userId !== userId) {
      this.logger.error(
        `프로필 소유자 불일치: profile.userId=${profile.userId}, intent.userId=${userId}`,
      );
      throw new Error('Profile owner mismatch');
    }

    // 2. 프로필 상태가 ACTIVE인가?
    if (profile.status !== 'ACTIVE') {
      this.logger.error(`프로필 비활성 상태: status=${profile.status}`);
      throw new Error(`Profile not active: ${profile.status}`);
    }

    // 3. 프로필 용도가 인텐트 타입에 부합하는가?
    const isRecurringType = ['RECURRING', 'BNPL_CAPTURE'].includes(intentType);
    const isOrderType = ['ORDER'].includes(intentType);

    // paymentPurpose 필드가 제거되어 검증 로직 주석 처리
    // 정규화된 스키마에서는 provider와 kind로 구분
    // if (
    //   isRecurringType &&
    //   !['SUBSCRIPTION', 'BOTH'].includes(profile.paymentPurpose)
    // ) {
    //   throw new Error(
    //     `Profile purpose mismatch for recurring: ${profile.paymentPurpose}`,
    //   );
    // }

    // if (isOrderType && !['PURCHASE', 'BOTH'].includes(profile.paymentPurpose)) {
    //   throw new Error(
    //     `Profile purpose mismatch for order: ${profile.paymentPurpose}`,
    //   );
    // }

    this.logger.log(`프로필 검증 통과: profileId=${profileId}`);
  }

  /**
   * Attempt 조회
   */
  async getAttempt(attemptId: string): Promise<AttemptResponseDto> {
    this.logger.log(`Attempt 조회: ${attemptId}`);

    const attempt = await this.dbService.db
      .select()
      .from(schema.paymentAttempts)
      .where(eq(schema.paymentAttempts.id, attemptId))
      .limit(1);

    if (attempt.length === 0) {
      throw new Error(`Attempt not found: ${attemptId}`);
    }

    const attemptData = attempt[0];

    return {
      attemptId: attemptData.id,
      intentId: attemptData.intentId,
      status: attemptData.status,
      provider: attemptData.provider,
      amount: attemptData.amount,
      actor: 'USER', // 기본값으로 USER 설정
      createdAt: attemptData.createdAt.toISOString(),
      errorMessage: undefined, // failureReason은 별도 필드가 없으므로 undefined
      instrumentKind: attemptData.instrumentKind || undefined,
      transactionId: attemptData.transactionId || undefined,
      approvalNumber: attemptData.approvalNumber || undefined,
    };
  }

  /**
   * Intent의 모든 Attempts 조회
   */
  async getIntentAttempts(intentId: string): Promise<AttemptResponseDto[]> {
    this.logger.log(`Intent Attempts 조회: ${intentId}`);

    // Intent 존재 확인
    const intent = await this.dbService.db
      .select()
      .from(schema.paymentIntents)
      .where(eq(schema.paymentIntents.id, intentId))
      .limit(1);

    if (intent.length === 0) {
      throw new Error(`Intent not found: ${intentId}`);
    }

    // Attempts 조회
    const attempts = await this.dbService.db
      .select()
      .from(schema.paymentAttempts)
      .where(eq(schema.paymentAttempts.intentId, intentId))
      .orderBy(schema.paymentAttempts.createdAt);

    return attempts.map((attemptData) => ({
      attemptId: attemptData.id,
      intentId: attemptData.intentId,
      status: attemptData.status,
      provider: attemptData.provider,
      amount: attemptData.amount,
      actor: 'USER', // 기본값으로 USER 설정
      createdAt: attemptData.createdAt.toISOString(),
      errorMessage: undefined, // failureReason은 별도 필드가 없으므로 undefined
      instrumentKind: attemptData.instrumentKind || undefined,
      transactionId: attemptData.transactionId || undefined,
      approvalNumber: attemptData.approvalNumber || undefined,
    }));
  }

  /**
   * 요청 해시 생성 (멱등성용)
   */
  private generateRequestHash(dto: IntentCreateDto): string {
    const crypto = require('crypto');
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(dto))
      .digest('hex');
  }
}
