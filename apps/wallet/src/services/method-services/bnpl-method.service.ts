// services/method-services/bnpl-method.service.ts
import { Injectable, Logger, Inject } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../../shared/database/schema';
import { eq } from 'drizzle-orm';
import { BnplMethodGateway } from '../../interfaces/payment-method-gateways.interface';
import {
  PaymentMethodRegistrationRequest,
  PaymentMethodRegistrationResult,
} from '../../interfaces/payment-gateway.interface';
import { HMS_BNPL_PAYMENT_ADAPTER } from '../../shared/tokens/gateway.tokens';
import { IdempotencyService } from '../idempotency.service';

/**
 * BNPL 결제수단 전용 서비스
 * - BNPL 라이프사이클 관리 (회원등록, 출금동의서, 상태조회)
 * - 배치 확정 처리
 * - 결제 실행은 PaymentOrchestrationService에서 담당
 */
@Injectable()
export class BnplMethodService {
  private readonly logger = new Logger(BnplMethodService.name);

  constructor(
    private readonly db: DbService<typeof schema>,
    @Inject(HMS_BNPL_PAYMENT_ADAPTER)
    private readonly bnplGateway: BnplMethodGateway,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * BNPL 회원 등록
   */
  async registerMember(
    request: PaymentMethodRegistrationRequest,
    idempotencyKey?: string,
  ): Promise<PaymentMethodRegistrationResult> {
    this.logger.log(`BNPL 회원 등록: ${request.memberName}`);

    return await this.db.db.transaction(async (tx) => {
      // 1. 멱등성 체크
      const idempotencyResult = await this.idempotency.checkOrCreate(
        tx,
        idempotencyKey,
        request,
        `/bnpl/register-member`,
      );
      if (idempotencyResult.hit)
        return idempotencyResult.response as PaymentMethodRegistrationResult;

      try {
        // 2. HMS BNPL 게이트웨이로 회원 등록
        const result = await this.bnplGateway.registerMember(request);

        if (!result.success) {
          throw new Error(result.error || 'BNPL 회원 등록에 실패했습니다');
        }

        // 3. 내부 결제수단 저장
        const [paymentMethod] = await tx
          .insert(schema.paymentMethod)
          .values({
            userId: request.userId,
            methodType: 'BNPL',
            methodName: `BNPL (${request.memberName})`,
            status: 'PENDING', // HMS 승인 대기
          })
          .returning();

        // 4. BNPL 계정 생성
        await tx.insert(schema.bnplAccount).values({
          id: result.hmsMemberId!,
          userId: request.userId,
          paymentMethodId: paymentMethod.id,
          status: 'ACTIVE', // 기본값에 맞게 수정
          creditLimit: request.creditLimit || 500000, // 기본 50만원
          approvedLimit: 0, // 승인 전에는 0
          billingCycleDay: request.billingCycleDay || 1,
        });

        const response = {
          ...result,
          paymentMethodId: paymentMethod.id,
          metadata: {
            ...result.metadata,
            internalPaymentMethodId: paymentMethod.id,
          },
        };

        await this.idempotency.complete(tx, idempotencyKey, response, 201);

        this.logger.log(`BNPL 회원 등록 완료: ${result.hmsMemberId}`);
        return response;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`BNPL 회원 등록 실패: ${errorMessage}`);

        const failureResponse = {
          success: false,
          paymentMethodId: '',
          error: errorMessage,
        };

        await this.idempotency.complete(
          tx,
          idempotencyKey,
          failureResponse,
          400,
        );
        return failureResponse;
      }
    });
  }

  /**
   * 출금동의서 제출
   */
  async submitConsent(
    memberId: string,
    file: Buffer,
    filename: string,
  ): Promise<{
    success: boolean;
    agreementId?: string;
    error?: string;
    rawResponse: any;
  }> {
    this.logger.log(`BNPL 출금동의서 제출: ${memberId}`);

    try {
      const result = await this.bnplGateway.submitConsent({
        memberId,
        file,
        filename,
      });

      if (result.success) {
        this.logger.log(`출금동의서 제출 성공: ${memberId}`);
      } else {
        this.logger.error(`출금동의서 제출 실패: ${result.error}`);
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`출금동의서 제출 중 오류: ${errorMessage}`);

      return {
        success: false,
        error: `출금동의서 제출 처리 중 오류: ${errorMessage}`,
        rawResponse: {},
      };
    }
  }

  /**
   * BNPL 회원 상태 조회
   */
  async getMemberStatus(memberId: string) {
    this.logger.log(`BNPL 회원 상태 조회: ${memberId}`);

    try {
      return await this.bnplGateway.getMemberStatus(memberId);
    } catch (error) {
      this.logger.error(
        `BNPL 회원 상태 조회 실패: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  /**
   * BNPL 배치 확정 처리
   */
  async batchCapture(
    authorizationIds: string[],
    batchId?: string,
    idempotencyKey?: string,
  ) {
    this.logger.log(`BNPL 배치 확정: ${authorizationIds.length}건`);

    return await this.db.db.transaction(async (tx) => {
      // 1. 멱등성 체크
      const idempotencyResult = await this.idempotency.checkOrCreate(
        tx,
        idempotencyKey,
        { authorizationIds, batchId },
        `/bnpl/batch-capture`,
      );
      if (idempotencyResult.hit) return idempotencyResult.response;

      try {
        // 2. BNPL 게이트웨이로 배치 확정
        const result = await this.bnplGateway.batchCapture(
          authorizationIds,
          batchId,
        );

        await this.idempotency.complete(tx, idempotencyKey, result, 201);

        this.logger.log(
          `BNPL 배치 확정 완료: ${result.captureIds.length}/${authorizationIds.length} 성공`,
        );

        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`BNPL 배치 확정 실패: ${errorMessage}`);

        const failureResponse = {
          success: false,
          captureIds: [],
          failedIds: authorizationIds,
          error: 'BNPL 배치 확정 처리 중 오류가 발생했습니다',
        };

        await this.idempotency.complete(
          tx,
          idempotencyKey,
          failureResponse,
          400,
        );
        return failureResponse;
      }
    });
  }

  /**
   * BNPL 계정 활성화 (스케줄러에서 호출)
   */
  async activateAccount(
    paymentMethodId: string,
    approvedLimit: number,
  ): Promise<void> {
    this.logger.log(
      `BNPL 계정 활성화: ${paymentMethodId}, 승인한도: ${approvedLimit}`,
    );

    await this.db.db.transaction(async (tx) => {
      // 1. 결제수단 활성화
      await tx
        .update(schema.paymentMethod)
        .set({
          status: 'ACTIVE',
          updatedAt: new Date(),
        })
        .where(eq(schema.paymentMethod.id, paymentMethodId));

      // 2. BNPL 계정 활성화 및 한도 설정
      await tx
        .update(schema.bnplAccount)
        .set({
          status: 'ACTIVE',
          approvedLimit,
          updatedAt: new Date(),
        })
        .where(eq(schema.bnplAccount.paymentMethodId, paymentMethodId));
    });

    this.logger.log(`BNPL 계정 활성화 완료: ${paymentMethodId}`);
  }

  /**
   * BNPL 계정 비활성화
   */
  async deactivateAccount(
    paymentMethodId: string,
    reason: string,
  ): Promise<void> {
    this.logger.log(`BNPL 계정 비활성화: ${paymentMethodId}, 사유: ${reason}`);

    await this.db.db.transaction(async (tx) => {
      // 1. 결제수단 비활성화
      await tx
        .update(schema.paymentMethod)
        .set({
          status: 'INACTIVE',
          updatedAt: new Date(),
        })
        .where(eq(schema.paymentMethod.id, paymentMethodId));

      // 2. BNPL 계정 비활성화
      await tx
        .update(schema.bnplAccount)
        .set({
          status: 'SUSPENDED',
          updatedAt: new Date(),
        })
        .where(eq(schema.bnplAccount.paymentMethodId, paymentMethodId));
    });

    this.logger.log(`BNPL 계정 비활성화 완료: ${paymentMethodId}`);
  }
}
