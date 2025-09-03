// services/payment-methods.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq, and } from 'drizzle-orm';
import { CreateGeneralPaymentMethodDto } from '../shared/dtos/create-general-payment-method.dto';
import {
  PaymentMethodResponseDto,
  UserPaymentMethodsResponseDto,
} from '../shared/dtos/payment-methods/payment-method-response.dto';
import { RegisterMethodResult } from '../ports/payment-method-adapter.port';
import { WalletTx } from '../shared/database';

import { BNPLService } from './bnpl.service';
import { IdempotencyService } from './Idempotency.service';

@Injectable()
export class PaymentMethodService {
  private readonly logger = new Logger(PaymentMethodService.name);

  constructor(
    private readonly db: DbService<typeof schema>,
    private readonly bnplService: BNPLService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** 일반 결제수단 등록 (카드, 포인트 등) - BNPL 제외 */
  async create(
    dto: CreateGeneralPaymentMethodDto,
  ): Promise<typeof schema.paymentMethod.$inferSelect> {
    this.logger.log(`결제수단 등록: ${dto.methodType} - ${dto.userId}`);

    return await this.db.db.transaction(async (tx) => {
      // 1. 비즈니스 검증
      await this.validatePaymentMethod(dto, tx);

      // 2. 결제수단 저장 (Drizzle 타입 추론 활용)
      const insertData: typeof schema.paymentMethod.$inferInsert = {
        userId: dto.userId,
        methodType: dto.methodType,
        methodName: dto.methodName,
        status: 'PENDING',
      };

      const [method] = await tx
        .insert(schema.paymentMethod)
        .values(insertData)
        .returning();

      // 3. 타입별 특화 처리 (추후 구현)
      this.processTypeSpecificLogic(dto, method);

      // 4. 활성화 (일반 결제수단은 즉시 활성화)
      await this.activatePaymentMethod(method.id, tx);

      this.logger.log(`결제수단 등록 완료: ${method.id}`);
      return method;
    });
  }

  /** 타입별 특화 로직 처리 */
  private processTypeSpecificLogic(
    dto: CreateGeneralPaymentMethodDto,
    method: typeof schema.paymentMethod.$inferSelect,
  ): void {
    switch (dto.methodType) {
      case 'CARD':
        // TODO: 카드 서비스 구현 시 토큰화 로직 추가
        this.logger.log(`카드 결제수단 생성: ${method.id}`);
        break;
      case 'REWARD_POINT':
        // TODO: 포인트 서비스 구현 시 계정 초기화 로직 추가
        this.logger.log(`포인트 결제수단 생성: ${method.id}`);
        break;
      // BANK_ACCOUNT는 현재 지원하지 않음 (CARD, REWARD_POINT만 지원)
      default:
        throw new BadRequestException(
          `지원하지 않는 결제수단 타입: ${dto.methodType as string}`,
        );
    }
  }

  private async validatePaymentMethod(
    dto: CreateGeneralPaymentMethodDto,
    tx: WalletTx,
  ): Promise<void> {
    // 사용자별 결제수단 개수 제한 등 비즈니스 규칙 검증
    const userMethods = await tx
      .select()
      .from(schema.paymentMethod)
      .where(eq(schema.paymentMethod.userId, dto.userId));

    if (userMethods.length >= 10) {
      throw new BadRequestException('결제수단은 최대 10개까지 등록 가능합니다');
    }

    // 타입별 추가 검증
    if (dto.methodType === 'CARD' && !dto.cardInfo) {
      throw new BadRequestException('카드 정보가 필요합니다');
    }
    // BANK_ACCOUNT 검증 제거됨 (현재 지원하지 않음)
  }

  private async activatePaymentMethod(id: string, tx: WalletTx): Promise<void> {
    await tx
      .update(schema.paymentMethod)
      .set({
        status: 'ACTIVE',
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentMethod.id, id));
  }

  /** 결제수단 조회 */
  async get(id: string): Promise<typeof schema.paymentMethod.$inferSelect> {
    const [method] = await this.db.db
      .select()
      .from(schema.paymentMethod)
      .where(eq(schema.paymentMethod.id, id))
      .limit(1);

    if (!method) {
      throw new NotFoundException('결제수단을 찾을 수 없습니다');
    }
    return method;
  }

  /** 사용자의 모든 결제수단 조회 */
  async findByUserId(
    userId: string,
  ): Promise<(typeof schema.paymentMethod.$inferSelect)[]> {
    return await this.db.db
      .select()
      .from(schema.paymentMethod)
      .where(eq(schema.paymentMethod.userId, userId));
  }

  /** 결제수단 해지 */
  async deactivate(id: string): Promise<{ success: boolean }> {
    const method = await this.get(id);
    this.logger.log(`결제수단 해지: ${method.methodType} - ${id}`);

    // BNPL은 별도 서비스에서 처리
    if (method.methodType === 'BNPL') {
      throw new BadRequestException('BNPL 해지는 별도 문의 바랍니다');
    }

    // TODO: 외부 서비스 해지 처리 (추후 각 결제사 서비스 구현 시)
    this.processTypeSpecificDeactivation(method);

    // 내부 상태 업데이트 (Drizzle 타입 추론 활용)
    const updateData: Partial<typeof schema.paymentMethod.$inferInsert> = {
      status: 'INACTIVE',
      updatedAt: new Date(),
    };

    await this.db.db
      .update(schema.paymentMethod)
      .set(updateData)
      .where(eq(schema.paymentMethod.id, id));

    this.logger.log(`결제수단 해지 완료: ${id}`);
    return { success: true };
  }

  /** 결제수단 검증 */
  async verify(id: string): Promise<boolean> {
    const method = await this.get(id);
    this.logger.log(`결제수단 검증: ${method.methodType} - ${id}`);

    // BNPL은 별도 서비스에서 처리
    if (method.methodType === 'BNPL') {
      throw new BadRequestException('BNPL 검증은 별도 API를 사용하세요');
    }

    // TODO: 각 결제사별 검증 로직 구현
    switch (method.methodType) {
      case 'CARD':
        // TODO: 카드 서비스 연동
        return true;
      case 'REWARD_POINT':
        // 포인트는 항상 유효
        return true;
      // BANK_ACCOUNT는 현재 지원하지 않음
      default:
        return false;
    }
  }

  private processTypeSpecificDeactivation(
    method: typeof schema.paymentMethod.$inferSelect,
  ): void {
    switch (method.methodType) {
      case 'CARD':
        // TODO: 카드 서비스에서 빌링키 해지
        this.logger.log(`카드 빌링키 해지 필요: ${method.id}`);
        break;
      // BANK_ACCOUNT는 현재 지원하지 않음
      case 'REWARD_POINT':
        // 포인트는 별도 해지 처리 없음
        break;
      default:
        break;
    }
  }

  // ===== 어댑터 패턴 기반 새로운 메서드들 =====

  /**
   * 어댑터 패턴으로 결제수단 등록
   */
  async createWithAdapter(
    dto: CreateGeneralPaymentMethodDto,
    idemKey?: string,
  ): Promise<PaymentMethodResponseDto> {
    this.logger.log(
      `어댑터 패턴 결제수단 등록: ${dto.methodType} - ${dto.userId}`,
    );

    return await this.db.db.transaction(async (tx) => {
      // 1. 멱등성 처리
      if (idemKey) {
        const idem =
          await this.idempotency.checkOrCreate<PaymentMethodResponseDto>(
            tx,
            idemKey,
            dto,
            `/payment-methods`,
          );
        if (idem.hit) return idem.response!;
      }

      // 2. 비즈니스 검증
      await this.validatePaymentMethod(dto, tx);

      // 3. 기본 결제수단 처리
      if (dto.isDefault) {
        await this.clearDefaultMethods(dto.userId, tx);
      }

      // 4. 외부 시스템 연동 (어댑터 패턴) - TODO: 실제 어댑터 팩토리 구현 후 활성화
      const adapterResult: RegisterMethodResult = { success: true };

      // TODO: PaymentMethodAdapterFactory 구현 후 활성화
      /*
      if (dto.methodType === 'CARD' || dto.methodType === 'REWARD_POINT') {
        const adapter = this.factory.getAdapter(dto.methodType);
        if (adapter) {
          adapterResult = await adapter.register({
            userId: dto.userId,
            methodType: dto.methodType,
            methodName: dto.methodName,
            cardInfo: dto.cardInfo,
          });
        }
      }

      if (!adapterResult.success) {
        throw new BadRequestException(
          adapterResult.error || '외부 시스템 등록 실패',
        );
      }
      */

      // 5. DB 저장
      const [method] = await tx
        .insert(schema.paymentMethod)
        .values({
          userId: dto.userId,
          methodType: dto.methodType,
          methodName: dto.methodName,
          status: 'ACTIVE', // 일반 결제수단은 즉시 ACTIVE
          isDefault: dto.isDefault || false,
        })
        .returning();

      // 6. 타입별 세부 정보 저장
      await this.saveMethodDetails(method, dto, adapterResult, tx);

      // 7. 응답 구성
      const response = this.toResponseDto(method, adapterResult);

      // 8. 멱등성 완료
      if (idemKey) {
        await this.idempotency.complete(tx, idemKey, response, 201);
      }

      this.logger.log(`결제수단 등록 완료: ${method.id}`);
      return response;
    });
  }

  /**
   * BNPL 승인 상태 포함한 결제수단 목록
   */
  async getUserMethodsWithStatus(
    userId: string,
  ): Promise<UserPaymentMethodsResponseDto> {
    const methods = await this.findByUserId(userId);

    // BNPL 상태 정보 추가
    const enrichedMethods = await Promise.all(
      methods.map(async (method) => {
        const baseResponse = this.toResponseDto(method);

        if (method.methodType === 'BNPL' && method.status === 'PENDING') {
          try {
            const bnplStatus = await this.bnplService.getMemberStatus(
              method.id,
            );
            return {
              ...baseResponse,
              bnplDetails: {
                approvalStatus: bnplStatus.status,
                estimatedApprovalDate: this.calculateEstimatedApprovalDate(
                  method.createdAt,
                ),
                remainingDays: this.calculateRemainingDays(method.createdAt),
                nextSteps: this.getBnplNextSteps(bnplStatus.status),
              },
            };
          } catch {
            this.logger.warn(`BNPL 상태 조회 실패: ${method.id}`);
          }
        }

        return baseResponse;
      }),
    );

    const usableMethods = enrichedMethods.filter((m) => m.status === 'ACTIVE');
    const pendingMethods = enrichedMethods.filter(
      (m) => m.status === 'PENDING',
    );

    return {
      usableMethods,
      pendingMethods,
      summary: {
        totalCount: enrichedMethods.length,
        activeCount: usableMethods.length,
        pendingCount: pendingMethods.length,
        defaultMethodId: usableMethods.find((m) => m.isDefault)?.id,
      },
    };
  }

  /**
   * 기본 결제수단 설정 (ACTIVE 상태만 가능)
   */
  async setAsDefault(
    methodId: string,
    userId: string,
  ): Promise<PaymentMethodResponseDto> {
    return await this.db.db.transaction(async (tx) => {
      const method = await this.findById(methodId);

      // 소유권 확인
      if (method.userId !== userId) {
        throw new BadRequestException('권한이 없습니다');
      }

      // ACTIVE 상태만 기본 설정 가능
      if (method.status !== 'ACTIVE') {
        throw new ConflictException(
          `사용 가능한 결제수단만 기본으로 설정할 수 있습니다. 현재 상태: ${method.status}`,
        );
      }

      // 기존 기본 결제수단 해제
      await this.clearDefaultMethods(userId, tx);

      // 새로운 기본 결제수단 설정
      const [updated] = await tx
        .update(schema.paymentMethod)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(schema.paymentMethod.id, methodId))
        .returning();

      return this.toResponseDto(updated);
    });
  }

  /**
   * 어댑터 패턴으로 결제수단 삭제
   */
  async deleteWithAdapter(
    methodId: string,
  ): Promise<{ success: boolean; message: string }> {
    const method = await this.findById(methodId);

    // BNPL은 별도 처리
    if (method.methodType === 'BNPL') {
      throw new BadRequestException('BNPL 해지는 고객센터로 문의해주세요');
    }

    // 외부 시스템 정리 - TODO: 실제 어댑터 팩토리 구현 후 활성화
    /*
    if (method.methodType === 'CARD' || method.methodType === 'REWARD_POINT') {
      const adapter = this.factory.getAdapter(method.methodType);
      if (adapter?.deactivate) {
        await adapter.deactivate(methodId);
      }
    }
    */

    // DB 삭제
    await this.db.db
      .delete(schema.paymentMethod)
      .where(eq(schema.paymentMethod.id, methodId));

    this.logger.log(`결제수단 삭제 완료: ${methodId}`);

    return {
      success: true,
      message: '결제수단이 삭제되었습니다',
    };
  }

  /**
   * 어댑터 패턴으로 결제수단 검증
   */
  async verifyWithAdapter(
    methodId: string,
  ): Promise<{ isValid: boolean; message: string }> {
    const method = await this.findById(methodId);

    if (method.methodType === 'BNPL') {
      throw new BadRequestException(
        'BNPL 상태는 /bnpl/status/:memberId로 확인하세요',
      );
    }

    const result = { isValid: true, message: '검증 완료' };

    // TODO: 실제 어댑터 팩토리 구현 후 활성화
    /*
    if (method.methodType === 'CARD' || method.methodType === 'REWARD_POINT') {
      const adapter = this.factory.getAdapter(method.methodType);
      if (adapter?.verify) {
        const verifyResult = await adapter.verify();
        result = {
          isValid: verifyResult.isValid,
          message: verifyResult.message || '검증 완료',
        };
      }
    }
    */

    return {
      isValid: result.isValid,
      message: result.message || '검증 완료',
    };
  }

  // ===== Private 헬퍼 메서드들 =====

  async findById(
    id: string,
  ): Promise<typeof schema.paymentMethod.$inferSelect> {
    const [method] = await this.db.db
      .select()
      .from(schema.paymentMethod)
      .where(eq(schema.paymentMethod.id, id))
      .limit(1);

    if (!method) {
      throw new NotFoundException('결제수단을 찾을 수 없습니다');
    }
    return method;
  }

  private async clearDefaultMethods(
    userId: string,
    tx: WalletTx,
  ): Promise<void> {
    await tx
      .update(schema.paymentMethod)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.paymentMethod.userId, userId),
          eq(schema.paymentMethod.isDefault, true),
        ),
      );
  }

  private async saveMethodDetails(
    method: typeof schema.paymentMethod.$inferSelect,
    dto: CreateGeneralPaymentMethodDto,
    adapterResult: RegisterMethodResult,
    tx: WalletTx,
  ): Promise<void> {
    switch (method.methodType) {
      case 'CARD':
        if (adapterResult.pgToken) {
          await tx.insert(schema.cardMethod).values({
            id: method.id,
            methodType: 'CARD',
            pgToken: adapterResult.pgToken,
            billingKey: adapterResult.billingKey || '',
            maskedCardNumber: adapterResult.maskedCardNumber || '',
            cardBrand: adapterResult.metadata?.cardBrand as string,
            cardType: adapterResult.metadata?.cardType as string,
            issuerName: adapterResult.metadata?.issuerName as string,
          });
        }
        break;
      // 포인트, 계좌는 별도 세부 테이블 없음
    }
  }

  private toResponseDto(
    method: typeof schema.paymentMethod.$inferSelect,
    adapterResult?: RegisterMethodResult,
  ): PaymentMethodResponseDto {
    return {
      id: method.id,
      userId: method.userId,
      methodType: method.methodType,
      methodName: method.methodName,
      status: method.status,
      isDefault: method.isDefault,
      maskedInfo: adapterResult?.maskedCardNumber,
      createdAt: method.createdAt.toISOString(),
    };
  }

  private calculateEstimatedApprovalDate(createdAt: Date): string {
    const estimated = new Date(createdAt);
    estimated.setDate(estimated.getDate() + 3); // 3일 후
    return estimated.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  private calculateRemainingDays(createdAt: Date): number {
    const now = new Date();
    const estimated = new Date(createdAt);
    estimated.setDate(estimated.getDate() + 3);

    const diffTime = estimated.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return Math.max(0, diffDays);
  }

  private getBnplNextSteps(status: string): string[] {
    switch (status) {
      case 'PENDING':
        return ['출금동의서 제출 대기 중'];
      case 'REGISTERED':
        return ['HMS 심사 진행 중', '2-3일 소요 예상'];
      default:
        return ['고객센터 문의 (1588-1234)'];
    }
  }
}
