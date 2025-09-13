// services/v2/payment-intent.service.ts - v4 아키텍처 Intent 서비스
import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { generateUUIDv7 } from '../shared/utils/id-generator';

import * as schema from '../shared/database/schema';
import { PaymentPolicyValidator } from '../shared/policies/payment-policy';
import {
  IntentCreateDto,
  IntentResponseDto,
  AttemptCreateDto,
  AttemptResponseDto,
  AttemptFinalizeDto,
} from '../shared/dtos/v2-payment.dto';
import {
  UniversalFinalizeDto,
  UniversalFinalizeResponseDto,
} from '../shared/dtos/universal-checkout.dto';
import { DbService } from '@app/db';
import { PaymentProviderFactory } from '../providers/payment-provider.factory';
import { WalletTx } from '../shared/database';

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
          if (existing[0].status === 'SUCCESS' && existing[0].responseBody) {
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
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24시간
        });
      }

      // 2. 정책 기반 Provider 결정 (보안 강화)
      // ✅ 서버 정책에서만 결정, 클라이언트 요청 무시
      const allowedProviders = this.policyValidator.getAllowedProviders(
        dto.type,
      );

      if (allowedProviders.length === 0) {
        throw new Error(`No available providers for intent type: ${dto.type}`);
      }

      // 3. Intent 생성
      const intentId = generateUUIDv7();
      const expiresAt = dto.expiresAt
        ? new Date(dto.expiresAt)
        : new Date(Date.now() + 30 * 60 * 1000); // 30분

      await tx.insert(schema.paymentIntents).values({
        id: intentId,
        customerId: dto.userId,
        amount: dto.amount,
        status: 'PENDING',
        type: dto.type,
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
            status: 'SUCCESS',
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

    // 런타임에 정책 기반으로 허용 프로바이더 계산
    const allowedProviders = this.resolveAllowedProviders(
      session.type,
      session.customerId,
    );

    return {
      intentId: session.id,
      status: session.status,
      amount: session.amount,
      type: session.type,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      allowedProviders,
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
      // 1) Intent 조회/기본 검증
      const [session] = await tx
        .select()
        .from(schema.paymentIntents)
        .where(eq(schema.paymentIntents.id, intentId))
        .limit(1);

      if (!session) throw new Error(`Intent not found: ${intentId}`);
      if (session.status !== 'PENDING') {
        throw new Error(`Intent already processed: ${session.status}`);
      }
      if (new Date() > session.expiresAt) {
        throw new Error('Intent expired');
      }

      // 2) 하드가드(BNPL_CAPTURE→CMS), 정책검증
      if (session.type === 'BNPL_CAPTURE' && dto.provider !== 'HMS_CARD') {
        this.logger.error(
          `하드가드 위반: BNPL_CAPTURE는 CMS만 허용 - 요청된 Provider: ${dto.provider}`,
        );
        throw new Error('policy.bnpl.capture.cms.only');
      }
      this.policyValidator.validateIntentProvider(
        session.type,
        dto.provider,
        !!dto.profileId,
        !!dto.instrumentRef,
      );

      // 3) 런타임 허용 Provider 확인
      const allowed = this.resolveAllowedProviders(
        session.type,
        session.customerId,
      );
      if (!allowed.includes(dto.provider as any)) {
        throw new Error(`Provider ${dto.provider} not allowed for this intent`);
      }

      // 4) 저장형 프로필 검증 (필요 시)
      if (dto.profileId) {
        await this.validateProfile(
          tx,
          dto.profileId,
          session.customerId,
          session.type,
        );
      }

      // 5) 내부용 실행(트랜잭션 내)으로 위임
      return this.createAttemptInternal(
        tx,
        intentId,
        session,
        dto,
        idempotencyKey,
      );
    });
  }

  // ===============================
  // v5 아키텍처: Universal Finalize API
  // ===============================

  /**
   * Universal Finalize (v5 아키텍처)
   * 모든 PG사의 최종 결제 승인을 처리하는 단일 창구
   */
  async universalFinalize(
    intentId: string,
    dto: UniversalFinalizeDto,
    idempotencyKey?: string,
  ): Promise<UniversalFinalizeResponseDto> {
    this.logger.log(
      `Universal Finalize 시작: intentId=${intentId}, provider=${dto.provider}`,
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

      // 2. 정책 기반 Provider 허용 여부 확인
      const allowedProviders = this.policyValidator.getAllowedProviders(
        session.type,
      );

      if (!allowedProviders.includes(dto.provider as any)) {
        throw new Error(
          `Provider ${dto.provider} not allowed for intent type ${session.type}`,
        );
      }

      // 3. 금액 검증 (선택적)
      if (dto.amount && dto.amount !== Number(session.amount)) {
        throw new Error(
          `Amount mismatch: expected ${session.amount}, got ${dto.amount}`,
        );
      }

      // 4. AttemptCreateDto로 변환하여 기존 로직 재사용
      const attemptDto: AttemptCreateDto = {
        provider: dto.provider as any,
        instrumentRef: dto.instrumentRef,
        actor: 'USER',
        source: 'api',
        metadata: dto.metadata || {},
      };

      // 5. 기존 createAttempt 로직 활용
      const attemptResult = await this.createAttemptInternal(
        tx,
        intentId,
        session,
        attemptDto,
        idempotencyKey,
      );

      // 6. Universal 응답 형식으로 변환
      const response: UniversalFinalizeResponseDto = {
        success: attemptResult.status === 'CAPTURED',
        intentId: intentId,
        attemptId: attemptResult.attemptId,
        amount: attemptResult.amount,
        status: attemptResult.status,
        provider: dto.provider,
        processedAt: new Date().toISOString(),
        errorMessage: attemptResult.errorMessage,
      };

      this.logger.log(
        `Universal Finalize 완료: ${attemptResult.attemptId}, 상태: ${attemptResult.status}`,
      );

      return response;
    });
  }

  /**
   * 런타임에 허용된 프로바이더 계산 (CTO 의도: 정책 기반)
   */
  private resolveAllowedProviders(intentType: any, customerId: string): any[] {
    // 1. 정책에서 기본 허용 프로바이더 가져오기
    const fromPolicy = this.policyValidator.getAllowedProviders(intentType);

    // 2. (선택) 사용자별 제한 사항 적용 (예: 심사 미완료, 연체 등)
    // const userEligible = this.checkUserEligibility(fromPolicy, customerId);

    // 3. (선택) 메타데이터의 임시 오버라이드 처리
    // const override = intent.metadata?.policyOverride?.allowedProviders;
    // return override ? fromPolicy.filter(p => override.includes(p)) : fromPolicy;

    // MVP: 정책 기본값만 사용
    return fromPolicy;
  }

  /**
   * 내부용 Attempt 생성 메서드 (트랜잭션 내에서 재사용)
   */
  private async createAttemptInternal(
    tx: any,
    intentId: string,
    session: typeof schema.paymentIntents.$inferSelect,
    dto: AttemptCreateDto,
    idempotencyKey?: string,
  ): Promise<AttemptResponseDto> {
    const attemptId = generateUUIDv7();

    // 하드가드 재확인
    if (session.type === 'BNPL_CAPTURE' && dto.provider !== 'HMS_CARD') {
      this.logger.error(
        `하드가드 위반: BNPL_CAPTURE는 CMS만 허용 - 요청된 Provider: ${dto.provider}`,
      );
      throw new Error('policy.bnpl.capture.cms.only');
    }

    let attemptStatus: 'AUTHORIZED' | 'CAPTURED' | 'FAILED' = 'FAILED';
    let transactionId: string | null = null;
    let approvalNumber: string | null = null;
    let errorMessage: string | null = null;

    if (dto.provider === 'HMS_BNPL') {
      // ── BNPL: 내부 승인만 ─────────────────────────────
      // 1) BNPL 계정 존재 확인 (payment_profile_id = profileId)
      const [account] = await tx
        .select()
        .from(schema.bnplAccounts)
        .where(eq(schema.bnplAccounts.paymentProfileId, dto.profileId!))
        .limit(1);

      if (!account) {
        throw new Error(`BNPL Account not found for profile ${dto.profileId}`);
      }

      // 2) 한도 체크 (MVP: 승인한도만 비교)
      if (Number(session.amount) > Number(account.approvedLimit)) {
        throw new Error(
          `BNPL 한도 초과: ${session.amount} > ${account.approvedLimit}`,
        );
      }

      // (옵션) TODO: 사용중 한도 집계하여 남은한도 확인 (AUTHORIZED/CAPTURED DEBIT - CREDIT)

      // 3) 내부 원장 기록 (DEBIT / AUTHORIZED)
      const bnplEventId = generateUUIDv7();
      await tx.insert(schema.bnplEvents).values({
        id: bnplEventId,
        bnplAccountId: account.id,
        paymentSessionId: intentId,
        transactionType: 'DEBIT',
        status: 'AUTHORIZED',
        amount: session.amount,
      });

      // 4) 승인 식별자(내부)
      transactionId = `BNPL_AUTH_${Date.now()}`;
      approvalNumber = transactionId;
      attemptStatus = 'AUTHORIZED';
    } else {
      // ── 일반 PG: 즉시 CAPTURE ─────────────────────────
      try {
        const result = await this.providerFactory
          .getProvider(dto.provider as any)
          .processPayment({
            intentId,
            attemptId,
            amount: session.amount,
            type: session.type,
            userId: session.customerId,
            instrumentType: dto.profileId ? 'PROFILE' : 'ONE_TIME',
            profileId: dto.profileId,
            instrumentRef: dto.instrumentRef,
            metadata: {
              type: session.type,
              customerId: session.customerId,
              source: dto.source || 'api',
            },
          });

        if (!result.success) {
          attemptStatus = 'FAILED';
          errorMessage = result.error || 'PG payment failed';
        } else {
          attemptStatus = 'CAPTURED';
          transactionId = result.transactionId || null;
          approvalNumber = result.metadata?.approvalNumber || null;
        }
      } catch (err: any) {
        this.logger.error(`Provider 결제 실행 실패: ${err?.message}`);
        attemptStatus = 'FAILED';
        errorMessage = err?.message ?? 'provider_error';
      }
    }

    // ── payment_attempts 저장 ───────────────────────────
    await tx.insert(schema.paymentAttempts).values({
      id: attemptId,
      intentId,
      provider: dto.provider,
      instrumentType: dto.profileId ? 'PROFILE' : 'ONE_TIME',
      instrumentRef: dto.instrumentRef || null,
      profileId: dto.profileId || null,
      amount: session.amount,
      status: attemptStatus,
      actor: dto.actor || 'USER',
      errorMessage,
      transactionId,
      approvalNumber,
      eventContext: JSON.stringify(
        dto.provider === 'HMS_BNPL'
          ? {
              bnpl: {
                ledgerEvent: 'AUTHORIZED',
                transactionId,
              },
              business: { type: session.type, source: dto.source || 'api' },
            }
          : {
              pg: {
                gateway: dto.provider.toLowerCase(),
                approvalNumber,
                transactionId,
              },
              business: { type: session.type, source: dto.source || 'api' },
            },
      ),
    });

    // ── payment_intents 업데이트 ────────────────────────
    await tx
      .update(schema.paymentIntents)
      .set({
        status: attemptStatus,
        authorizedAt: attemptStatus !== 'FAILED' ? new Date() : null,
        capturedAt: attemptStatus === 'CAPTURED' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentIntents.id, intentId));

    return {
      attemptId,
      intentId,
      provider: dto.provider,
      status: attemptStatus,
      amount: session.amount,
      createdAt: new Date().toISOString(),
      actor: dto.actor || 'USER',
      errorMessage: errorMessage || undefined,
      instrumentType: dto.profileId ? 'PROFILE' : 'ONE_TIME',
      transactionId: transactionId || undefined,
      approvalNumber: approvalNumber || undefined,
    };
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
      HMS_CARD: 'HMS_CARD',
      TOSS: 'TOSS',
      KAKAOPAY: 'KAKAOPAY',
      HMS_BNPL: 'HMS_BNPL',
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
        attemptId: generateUUIDv7(),
        amount,
        type: metadata.type || 'ORDER',
        userId: metadata.userId,
        instrumentType: metadata.paymentMethodId ? 'PROFILE' : 'ONE_TIME',
        profileId: metadata.paymentMethodId,
        instrumentRef: metadata.instrumentRef,
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
        transactionId: `${provider.toLowerCase()}_${generateUUIDv7()}`,
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
      instrumentType: attemptData.instrumentType || undefined,
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
      instrumentType: attemptData.instrumentType || undefined,
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
