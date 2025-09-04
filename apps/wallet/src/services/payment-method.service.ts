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
// 사용하지 않는 타입 제거
import { WalletTx } from '../shared/database';

import { PaymentService } from './payment.service';
import { IdempotencyService } from './idempotency.service';

@Injectable()
export class PaymentMethodService {
  private readonly logger = new Logger(PaymentMethodService.name);

  constructor(
    private readonly db: DbService<typeof schema>,
    private readonly paymentService: PaymentService, // 통합 서비스 사용
    private readonly idempotency: IdempotencyService,
  ) {}

  // create 메서드는 createWithIdempotency로 통합되어 제거

  // 타입별 특화 로직은 각 MethodService에서 처리하므로 제거

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

  // 활성화는 createWithIdempotency에서 직접 처리하므로 제거

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

  // deactivate는 delete로 통합되어 제거

  // 검증은 각 MethodService에서 처리하므로 제거

  /**
   * 멱등성을 지원하는 결제수단 등록 (createWithAdapter를 기본 create로 통합)
   */
  async createWithIdempotency(
    dto: CreateGeneralPaymentMethodDto,
    idemKey?: string,
  ): Promise<PaymentMethodResponseDto> {
    this.logger.log(`결제수단 등록: ${dto.methodType} - ${dto.userId}`);

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

      // 3. methodType별 외부 시스템 등록 처리
      let externalResult: any = null;
      let initialStatus = 'ACTIVE'; // 기본값

      if (dto.methodType === 'CARD' && dto.cardInfo) {
        // HMS CMS 정기결제 회원 등록
        const [year, month] = dto.cardInfo.expiryDate.split('/');
        const registrationRequest = {
          userId: dto.userId,
          memberName: dto.methodName,
          phone: dto.cardInfo.phone || '', // DTO에서 전화번호 가져오기
          paymentNumber: dto.cardInfo.cardNumber,
          payerName: dto.cardInfo.cardHolderName,
          validYear: `20${year}`, // YY -> YYYY
          validMonth: month,
          billingCycleDay: dto.cardInfo.billingCycleDay || 1,
        };

        externalResult = await this.paymentService.registerPaymentMethod(
          'CARD',
          registrationRequest,
        );

        if (!externalResult.success) {
          throw new Error(externalResult.error || 'HMS CMS 회원 등록 실패');
        }

        initialStatus = 'PENDING'; // HMS 승인 대기
        this.logger.log(
          `HMS CMS 회원 등록 성공: ${externalResult.hmsMemberId}`,
        );
      }

      // 4. 기본 결제수단 처리
      if (dto.isDefault) {
        await this.clearDefaultMethods(dto.userId, tx);
      }

      // 5. 내부 DB 저장 (외부 등록 결과 반영)
      const [method] = await tx
        .insert(schema.paymentMethod)
        .values({
          userId: dto.userId,
          methodType: dto.methodType,
          methodName: dto.methodName,
          status: initialStatus as 'PENDING' | 'ACTIVE' | 'INACTIVE',
          isDefault: dto.isDefault || false,
        })
        .returning();

      // 6. HMS CMS 카드인 경우 추가 정보 저장
      if (dto.methodType === 'CARD' && externalResult?.hmsMemberId) {
        await tx.insert(schema.batchCmsMethod).values({
          id: method.id, // paymentMethodId와 동일한 ID 사용
          paymentMethodId: method.id,
          hmsMemberId: externalResult.hmsMemberId,
          creditLimit: 1000000, // 기본 100만원
          approvedLimit: 0, // 승인 전에는 0
          billingCycleDay: 1, // 기본값
        });
      }

      // 7. 응답 구성
      const response = this.toResponseDto(method, externalResult);

      // 6. 멱등성 완료
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
            // BNPL 상태는 PaymentService에서 조회
            const bnplStatus = await this.paymentService.getMemberStatus(
              'BNPL',
              method.id,
            );
            const statusData = bnplStatus as {
              status?: string;
              hmsStatus?: string;
            };
            return {
              ...baseResponse,
              bnplDetails: {
                approvalStatus: statusData.status || 'PENDING',
                estimatedApprovalDate: this.calculateEstimatedApprovalDate(
                  method.createdAt,
                ),
                remainingDays: this.calculateRemainingDays(method.createdAt),
                nextSteps: this.getBnplNextSteps(
                  statusData.hmsStatus || 'PENDING',
                ),
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
   * 결제수단 삭제 (간단한 삭제만 처리)
   */
  async delete(
    methodId: string,
  ): Promise<{ success: boolean; message: string }> {
    const method = await this.findById(methodId);

    // BNPL은 별도 처리
    if (method.methodType === 'BNPL') {
      throw new BadRequestException('BNPL 해지는 고객센터로 문의해주세요');
    }

    // DB 삭제 (복잡한 해지는 각 MethodService에서 처리)
    await this.db.db
      .delete(schema.paymentMethod)
      .where(eq(schema.paymentMethod.id, methodId));

    this.logger.log(`결제수단 삭제 완료: ${methodId}`);

    return {
      success: true,
      message: '결제수단이 삭제되었습니다',
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

  // 세부 정보 저장은 각 MethodService에서 처리하므로 제거

  private toResponseDto(
    method: typeof schema.paymentMethod.$inferSelect,
    externalResult?: any,
  ): PaymentMethodResponseDto {
    return {
      id: method.id,
      userId: method.userId,
      methodType: method.methodType,
      methodName: method.methodName,
      status: method.status,
      isDefault: method.isDefault,
      maskedInfo: externalResult?.metadata?.maskedCardNumber || undefined,
      hmsMemberId: externalResult?.hmsMemberId || undefined,
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
