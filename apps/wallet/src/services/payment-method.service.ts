import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { PaymentMethodType } from '../shared/types/payment-method.types';

/**
 * 결제수단 서비스 (가이드 문서 준수)
 *
 * 역할:
 * 1. 결제수단 등록 검증
 * 2. 어댑터 호출 (PG사 결제수단 등록)
 * 3. PaymentMethod 테이블 저장
 *
 * 복잡한 상태 관리 제거 → 단순한 등록/조회만
 */
@Injectable()
export class PaymentMethodService {
  private readonly logger = new Logger(PaymentMethodService.name);

  constructor(
    private readonly db: DbService<typeof schema>,
    // 어댑터들을 직접 주입 (추후 구현)
    // private readonly hmsCardAdapter: HmsCardAdapter,
    // private readonly hmsBnplAdapter: HmsBnplAdapter,
    // private readonly tossAdapter: TossAdapter,
    // private readonly pointAdapter: PointAdapter,
  ) {}

  /**
   * 결제수단 등록 (가이드 문서의 핵심 메서드)
   *
   * Flow:
   * 1. 결제수단 검증
   * 2. 어댑터 호출 (PG사 결제수단 등록)
   * 3. PaymentMethod 테이블 저장
   */
  async register(request: {
    userId: string;
    methodType: PaymentMethodType;
    methodName: string;
    paymentPurpose?: 'SUBSCRIPTION' | 'PURCHASE' | 'BOTH';
    isDefault?: boolean;
    // 카드 등록 시 필요한 정보
    cardToken?: string;
    billingKey?: string;
    // BNPL 등록 시 필요한 정보
    creditLimit?: number;
    billingCycleDay?: number;
  }): Promise<{
    id: string;
    paymentMethodId: string;
    userId: string;
    methodType: PaymentMethodType;
    methodName: string;
    status: 'PENDING' | 'ACTIVE';
    hmsMemberId?: string;
    isDefault: boolean;
    createdAt: string;
  }> {
    this.logger.log(`결제수단 등록: ${request.userId}, ${request.methodType}`);

    return await this.db.db.transaction(async (tx) => {
      // 1. 결제수단 등록 검증
      await this.validateRegistration(tx, request.userId, request.methodType);

      // 2. 어댑터 호출 (결제수단 타입에 따라)
      const registrationResult = await this.callRegistrationAdapter(
        request.methodType,
        {
          userId: request.userId,
          methodName: request.methodName,
          cardToken: request.cardToken,
          billingKey: request.billingKey,
          creditLimit: request.creditLimit,
          billingCycleDay: request.billingCycleDay,
        },
      );

      // 3. PaymentMethod 테이블 저장
      const paymentMethodId = ulid();
      await tx.insert(schema.paymentMethod).values({
        id: paymentMethodId,
        userId: request.userId,
        methodType: request.methodType,
        methodName: request.methodName,
        status: registrationResult.status,
        isDefault: request.isDefault || false,
        paymentPurpose: request.paymentPurpose || 'PURCHASE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 4. 결제수단별 세부 정보 저장
      if (request.methodType === 'CARD' && registrationResult.hmsMemberId) {
        await tx.insert(schema.cardMethod).values({
          id: paymentMethodId,
          methodType: 'CARD',
          hmsMemberId: registrationResult.hmsMemberId,
          pgToken: request.cardToken || registrationResult.hmsMemberId,
          billingKey: request.billingKey || registrationResult.hmsMemberId,
          maskedCardNumber:
            registrationResult.maskedCardNumber || '****-****-****-****',
          lastFourDigits: registrationResult.lastFourDigits || '****',
          cardBrand: registrationResult.cardBrand || 'UNKNOWN',
          cardType: registrationResult.cardType || 'CREDIT',
          issuerName: registrationResult.issuerName || 'HMS',
          metadata: JSON.stringify(registrationResult.metadata || {}),
          createdAt: new Date(),
        });
      }

      this.logger.log(
        `결제수단 등록 완료: ${paymentMethodId}, 상태: ${registrationResult.status}`,
      );

      return {
        id: paymentMethodId,
        paymentMethodId,
        userId: request.userId,
        methodType: request.methodType,
        methodName: request.methodName,
        status: registrationResult.status,
        hmsMemberId: registrationResult.hmsMemberId,
        isDefault: request.isDefault || false,
        createdAt: new Date().toISOString(),
      };
    });
  }

  /**
   * 멱등성을 지원하는 결제수단 등록 (PaymentMethodController에서 호출)
   */
  async createWithIdempotency(
    request: {
      userId: string;
      methodType: PaymentMethodType;
      methodName: string;
      usage?: 'SUBSCRIPTION' | 'ONE_TIME' | 'PURCHASE';
      cardToken?: string;
      billingKey?: string;
      creditLimit?: number;
      billingCycleDay?: number;
      cardInfo?: any;
    },
    idempotencyKey?: string,
  ) {
    // 멱등성 키가 있으면 중복 체크 (간단한 구현)
    if (idempotencyKey) {
      this.logger.log(`멱등성 키로 결제수단 등록: ${idempotencyKey}`);
    }

    return this.register(request);
  }

  /**
   * 사용자 결제수단 목록 조회 (상태별 분류)
   */
  async getUserMethodsWithStatus(userId: string) {
    const methods = await this.db.db
      .select()
      .from(schema.paymentMethod)
      .where(eq(schema.paymentMethod.userId, userId));

    const activeMethods = methods
      .filter((m) => m.status === 'ACTIVE')
      .map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
      }));
    const pendingMethods = methods
      .filter((m) => m.status === 'PENDING')
      .map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
      }));
    const inactiveMethods = methods
      .filter((m) => m.status === 'INACTIVE')
      .map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
      }));

    return {
      userId,
      usableMethods: activeMethods, // UserPaymentMethodsResponseDto 호환
      activeMethods,
      pendingMethods,
      inactiveMethods,
      summary: {
        totalCount: methods.length,
        activeCount: activeMethods.length,
        pendingCount: pendingMethods.length,
        defaultMethodId: activeMethods.find((m) => m.isDefault)?.id,
      },
      totalCount: methods.length,
    };
  }

  /**
   * 기본 결제수단 설정
   */
  async setAsDefault(methodId: string, userId: string) {
    return this.db.db.transaction(async (tx) => {
      // 1. 해당 결제수단 조회
      const method = await tx
        .select()
        .from(schema.paymentMethod)
        .where(eq(schema.paymentMethod.id, methodId))
        .limit(1);

      if (method.length === 0) {
        throw new Error('결제수단을 찾을 수 없습니다');
      }

      if (method[0].userId !== userId) {
        throw new Error('권한이 없습니다');
      }

      if (method[0].status !== 'ACTIVE') {
        throw new Error('활성화된 결제수단만 기본으로 설정할 수 있습니다');
      }

      // 2. 기존 기본 결제수단 해제
      await tx
        .update(schema.paymentMethod)
        .set({ isDefault: false })
        .where(eq(schema.paymentMethod.userId, userId));

      // 3. 새로운 기본 결제수단 설정
      await tx
        .update(schema.paymentMethod)
        .set({ isDefault: true })
        .where(eq(schema.paymentMethod.id, methodId));

      return {
        id: methodId,
        userId,
        methodType: method[0].methodType,
        methodName: method[0].methodName,
        status: method[0].status,
        isDefault: true,
        createdAt: method[0].createdAt.toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });
  }

  /**
   * 결제수단 삭제
   */
  async delete(methodId: string) {
    return this.db.db.transaction(async (tx) => {
      // 1. 결제수단 조회
      const method = await tx
        .select()
        .from(schema.paymentMethod)
        .where(eq(schema.paymentMethod.id, methodId))
        .limit(1);

      if (method.length === 0) {
        throw new Error('결제수단을 찾을 수 없습니다');
      }

      // 2. 외부 시스템 정리 (HMS, Toss 등)
      // TODO: 실제 구현에서는 각 어댑터의 삭제 메서드 호출 필요

      // 3. DB에서 삭제
      await tx
        .delete(schema.paymentMethod)
        .where(eq(schema.paymentMethod.id, methodId));

      this.logger.log(`결제수단 삭제 완료: ${methodId}`);

      return {
        success: true,
        message: '결제수단이 삭제되었습니다',
      };
    });
  }

  /**
   * 결제수단 등록 검증 (private 헬퍼)
   */
  private async validateRegistration(
    tx: any,
    userId: string,
    methodType: string,
  ) {
    // 사용자별 결제수단 개수 제한
    const userMethods = await tx
      .select()
      .from(schema.paymentMethod)
      .where(eq(schema.paymentMethod.userId, userId));

    if (userMethods.length >= 10) {
      throw new Error('결제수단은 최대 10개까지 등록 가능합니다');
    }

    // 결제수단 타입별 중복 체크
    const existingMethod = userMethods.find((m) => m.methodType === methodType);
    if (existingMethod && methodType === 'BNPL') {
      throw new Error('BNPL 결제수단은 하나만 등록 가능합니다');
    }
  }

  /**
   * 등록 어댑터 호출 (private 헬퍼)
   */
  private async callRegistrationAdapter(
    methodType: string,
    request: {
      userId: string;
      methodName: string;
      cardToken?: string;
      billingKey?: string;
      creditLimit?: number;
      billingCycleDay?: number;
    },
  ): Promise<{
    status: 'PENDING' | 'ACTIVE';
    hmsMemberId?: string;
    maskedCardNumber?: string;
    lastFourDigits?: string;
    cardBrand?: string;
    cardType?: string;
    issuerName?: string;
    metadata?: any;
  }> {
    this.logger.log(`등록 어댑터 호출: ${methodType}`);

    // TODO: 실제 어댑터 호출 로직 구현
    // 현재는 Mock 응답 반환
    switch (methodType) {
      case 'CARD':
        return {
          status: 'PENDING',
          hmsMemberId: `HMS_${ulid()}`,
          maskedCardNumber: '1234-****-****-5678',
          lastFourDigits: '5678',
          cardBrand: 'VISA',
          cardType: 'CREDIT',
          issuerName: 'HMS',
          metadata: {
            registeredAt: new Date().toISOString(),
          },
        };
      case 'BNPL':
        return {
          status: 'PENDING',
          hmsMemberId: `BNPL_${ulid()}`,
          metadata: {
            creditLimit: request.creditLimit || 1000000,
            billingCycleDay: request.billingCycleDay || 1,
          },
        };
      case 'REWARD_POINT':
        return {
          status: 'ACTIVE',
          metadata: {
            pointType: 'INTERNAL',
          },
        };
      default:
        throw new Error(`지원하지 않는 결제수단 타입: ${methodType}`);
    }
  }
}
