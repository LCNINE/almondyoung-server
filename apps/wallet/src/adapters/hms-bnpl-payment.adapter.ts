// adapters/hms-bnpl-payment.adapter.ts
import { Injectable, Logger } from '@nestjs/common';
import { HmsAPI, MockHmsAPI } from 'hms-api-wrapper';
import { HmsApiFactory } from '../shared/utils/hms-api.factory';
import { getTsid } from 'tsid-ts';
import { ulid } from 'ulid';
import {
  PaymentGateway,
  PaymentMetadata,
  PaymentResult,
  RefundResult,
  CaptureResult,
  PaymentMethodRegistrationRequest,
  PaymentMethodRegistrationResult,
} from '../interfaces/payment-gateway.interface';
import { BnplMethodGateway } from '../interfaces/payment-method-gateways.interface';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';
import { Money } from '../shared/utils/money.util';

/**
 * HMS BNPL 결제 어댑터 (표준 간소화)
 * - processPayment(): 내부 승인만 (실제 출금X)
 * - capturePayment(): 실제 HMS 출금 실행 (배치)
 * - refundPayment(): 결제 환불
 * - registerPaymentMethod(): BNPL 회원 등록
 */
@Injectable()
export class HmsBnplPaymentAdapter
  implements PaymentGateway, BnplMethodGateway
{
  private readonly logger = new Logger(HmsBnplPaymentAdapter.name);
  private readonly hmsApi: HmsAPI | MockHmsAPI;

  constructor(private readonly db: DbService<typeof schema>) {
    // 🎯 BNPL은 항상 Mock 서버 사용 (Test 서버는 수동 승인 필요)
    this.hmsApi = HmsApiFactory.createForBnpl();
    this.logger.log(
      `HMS BNPL 어댑터 초기화 완료 - Mock 서버 사용 (수동 승인 시뮬레이션)`,
    );
  }

  /**
   * BNPL 결제 승인 (내부 한도 차감만)
   */
  async processPayment(
    amount: number,
    currency: string = 'KRW',
    metadata?: PaymentMetadata,
  ): Promise<PaymentResult> {
    const amountKRW = Money.toKRWInt(amount);
    Money.validate(amountKRW);

    this.logger.log(
      `HMS BNPL 승인 처리: ${metadata?.bnplAccountId}, 금액: ${amountKRW}KRW`,
    );

    try {
      return await this.db.db.transaction(async (tx) => {
        // 1. BNPL 계정 조회 및 한도 확인
        const [bnplAccount] = await tx
          .select()
          .from(schema.bnplAccount)
          .where(eq(schema.bnplAccount.id, metadata?.bnplAccountId!))
          .limit(1);

        if (!bnplAccount || bnplAccount.status !== 'ACTIVE') {
          return {
            success: false,
            transactionId: '',
            error: 'BNPL 계정을 찾을 수 없거나 비활성화 상태입니다',
          };
        }

        const currentLimit = Money.toKRWInt(bnplAccount.approvedLimit);
        if (currentLimit < amountKRW) {
          return {
            success: false,
            transactionId: '',
            error: '잔여 한도가 부족합니다',
            metadata: {
              remainingLimit: currentLimit,
              requestedAmount: amountKRW,
            },
          };
        }

        // 2. 승인 트랜잭션 생성 (실제 출금X)
        const authorizationId = ulid();
        await tx.insert(schema.bnplTransaction).values({
          id: authorizationId,
          bnplAccountId: bnplAccount.id,
          paymentSessionId: metadata?.sessionId || '',
          transactionType: 'DEBIT',
          status: 'AUTHORIZED',
          amount: amountKRW,
        });

        // 3. 한도 차감
        await tx
          .update(schema.bnplAccount)
          .set({
            approvedLimit: currentLimit - amountKRW,
            updatedAt: new Date(),
          })
          .where(eq(schema.bnplAccount.id, bnplAccount.id));

        this.logger.log(`HMS BNPL 승인 완료: ${authorizationId}`);

        return {
          success: true,
          transactionId: authorizationId,
          authorizationId, // BNPL은 승인ID 별도 제공
          metadata: {
            provider: 'hms_bnpl',
            method: 'authorization_only',
            bnplAccountId: bnplAccount.id,
            remainingLimit: currentLimit - amountKRW,
            authorizedAt: new Date().toISOString(),
          },
        };
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`HMS BNPL 승인 실패: ${errorMessage}`);

      return {
        success: false,
        transactionId: '',
        error: 'BNPL 승인 처리 중 오류가 발생했습니다',
      };
    }
  }

  /**
   * BNPL 결제 확정 (실제 HMS 출금) - PaymentGateway 인터페이스용
   */
  async capturePayment(
    authorizationIds: string[],
    batchId?: string,
  ): Promise<CaptureResult> {
    return this.batchCapture(authorizationIds, batchId);
  }

  /**
   * BNPL 배치 확정 (실제 HMS 출금) - BnplMethodGateway 인터페이스용
   */
  async batchCapture(
    authorizationIds: string[],
    batchId?: string,
  ): Promise<CaptureResult> {
    this.logger.log(`HMS BNPL 배치 출금: ${authorizationIds.length}건`);

    const captureIds: string[] = [];
    const failedIds: string[] = [];

    try {
      for (const authorizationId of authorizationIds) {
        try {
          const result = await this.db.db.transaction(async (tx) => {
            // 1. 승인 트랜잭션 조회
            const [bnplTransaction] = await tx
              .select()
              .from(schema.bnplTransaction)
              .where(eq(schema.bnplTransaction.id, authorizationId))
              .limit(1);

            if (!bnplTransaction || bnplTransaction.status !== 'AUTHORIZED') {
              throw new Error('승인되지 않은 트랜잭션입니다');
            }

            // 2. 실제 HMS 출금 요청
            const amountKRW = Money.toKRWInt(bnplTransaction.amount);
            const hmsResult = await this.requestHmsWithdrawal({
              memberId: bnplTransaction.bnplAccountId,
              amount: amountKRW,
              paymentDate: new Date().toISOString().split('T')[0],
              invoiceId: authorizationId,
            });

            if (!hmsResult.success) {
              throw new Error(hmsResult.error || 'HMS 출금 요청 실패');
            }

            // 3. 트랜잭션 상태 업데이트
            await tx
              .update(schema.bnplTransaction)
              .set({ status: 'CAPTURED' })
              .where(eq(schema.bnplTransaction.id, authorizationId));

            return hmsResult.transactionId;
          });

          captureIds.push(result);
          this.logger.log(`HMS BNPL 출금 성공: ${authorizationId}`);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(
            `HMS BNPL 출금 실패: ${authorizationId} - ${errorMessage}`,
          );
          failedIds.push(authorizationId);
        }
      }

      return {
        success: captureIds.length > 0,
        captureIds,
        failedIds,
        metadata: {
          provider: 'hms_bnpl',
          batchId,
          totalCount: authorizationIds.length,
          successCount: captureIds.length,
          failureCount: failedIds.length,
          processedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`HMS BNPL 배치 출금 전체 실패: ${errorMessage}`);

      return {
        success: false,
        captureIds: [],
        failedIds: authorizationIds,
        error: 'BNPL 배치 처리 중 오류가 발생했습니다',
      };
    }
  }

  async refundPayment(
    transactionId: string,
    amount: number,
    reason?: string,
  ): Promise<RefundResult> {
    const amountKRW = Money.toKRWInt(amount);
    Money.validate(amountKRW);

    this.logger.log(`HMS BNPL 환불: ${transactionId}, 금액: ${amountKRW}KRW`);

    try {
      return await this.db.db.transaction(async (tx) => {
        // 1. 원본 트랜잭션 조회
        const [originalTransaction] = await tx
          .select()
          .from(schema.bnplTransaction)
          .where(eq(schema.bnplTransaction.id, transactionId))
          .limit(1);

        if (!originalTransaction) {
          throw new Error('원본 BNPL 트랜잭션을 찾을 수 없습니다');
        }

        // 2. 환불 트랜잭션 생성 (현재는 로컬 처리만)
        const refundId = ulid();
        await tx.insert(schema.bnplTransaction).values({
          id: refundId,
          bnplAccountId: originalTransaction.bnplAccountId,
          paymentSessionId: originalTransaction.paymentSessionId,
          transactionType: 'CREDIT',
          status: 'CAPTURED',
          amount: amountKRW,
        });

        return {
          success: true,
          refundId,
          refundedAmount: amountKRW,
          metadata: {
            provider: 'hms_bnpl',
            originalTransactionId: transactionId,
            refundedAt: new Date().toISOString(),
            reason: reason || '고객 요청',
          },
        };
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`HMS BNPL 환불 실패: ${errorMessage}`);

      return {
        success: false,
        refundId: '',
        refundedAmount: 0,
        error: 'BNPL 환불 처리 중 오류가 발생했습니다',
      };
    }
  }

  /**
   * BNPL 회원 등록 (BatchCMS API) - PaymentGateway 인터페이스용
   */
  async registerPaymentMethod(
    request: PaymentMethodRegistrationRequest,
  ): Promise<PaymentMethodRegistrationResult> {
    return this.registerMember(request);
  }

  /**
   * BNPL 회원 등록 (BatchCMS API) - BnplMethodGateway 인터페이스용
   */
  async registerMember(
    request: PaymentMethodRegistrationRequest,
  ): Promise<PaymentMethodRegistrationResult> {
    this.logger.log(`HMS BNPL 회원 등록: ${request.memberName}`);

    try {
      const response = await this.hmsApi.members.create({
        memberId: getTsid().toString(),
        memberName: request.memberName,
        payerName: request.memberName,
        paymentKind: 'CMS',
        paymentCompany: 'BATCHCMS',
        paymentNumber: ulid(),
        payerNumber: ulid(),
        phone: request.phone,
      });

      return {
        success: true,
        paymentMethodId: response.member.memberId,
        hmsMemberId: response.member.memberId,
        metadata: {
          provider: 'hms_bnpl',
          hmsStatus: response.member.status,
          creditLimit: request.creditLimit,
          billingCycleDay: request.billingCycleDay,
          rawResponse: response,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'HMS API 호출 실패';
      this.logger.error(`HMS BNPL 회원 등록 실패: ${errorMessage}`);

      return {
        success: false,
        paymentMethodId: '',
        error: `BNPL 회원 등록 실패: ${errorMessage}`,
      };
    }
  }

  /**
   * BNPL 전용: 출금동의서 제출 (BnplMethodGateway 인터페이스)
   */
  async submitConsent(request: {
    memberId: string;
    file: Buffer;
    filename: string;
  }): Promise<{
    success: boolean;
    agreementId?: string;
    error?: string;
    rawResponse: any;
  }> {
    this.logger.log(`HMS BNPL 출금동의서 제출: ${request.memberId}`);

    try {
      const result = await this.hmsApi.agreements.register(
        'default-cust',
        request.memberId,
        {
          file: request.file,
          filename: request.filename,
        },
      );

      return {
        success: true,
        agreementId: 'agreement-' + Date.now(),
        rawResponse: result,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'HMS API 호출 실패';
      this.logger.error(`HMS BNPL 출금동의서 제출 실패: ${errorMessage}`);

      return {
        success: false,
        error: `출금동의서 제출 실패: ${errorMessage}`,
        rawResponse: {},
      };
    }
  }

  /**
   * BNPL 전용: 회원 상태 조회 (BnplMethodGateway 인터페이스)
   */
  async getMemberStatus(memberId: string): Promise<{
    hmsStatus: string;
    registeredAt: Date | null;
    creditLimit: number;
    approvedLimit: number;
    rawResponse: any;
  }> {
    this.logger.log(`HMS BNPL 회원 상태 조회: ${memberId}`);

    try {
      const result = await this.hmsApi.members.get(memberId);

      return {
        hmsStatus: result.member.status || 'UNKNOWN',
        registeredAt: null, // HMS API 응답에서 등록일시는 별도 관리
        creditLimit: 0, // HMS에서 제공하지 않으므로 내부에서 관리
        approvedLimit: 0, // HMS에서 제공하지 않으므로 내부에서 관리
        rawResponse: result,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'HMS API 호출 실패';
      this.logger.error(`HMS BNPL 회원 상태 조회 실패: ${errorMessage}`);
      throw error;
    }
  }

  // === Private Helper Methods ===

  private async requestHmsWithdrawal(request: {
    memberId: string;
    amount: number;
    paymentDate: string;
    invoiceId: string;
  }): Promise<{
    success: boolean;
    transactionId: string;
    error?: string;
  }> {
    try {
      const result = await this.hmsApi.withdrawals.request({
        memberId: request.memberId,
        callAmount: request.amount,
        paymentDate: request.paymentDate,
        transactionId: getTsid().toString(),
      });

      return {
        success: true,
        transactionId: result.payment.transactionId,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'HMS API 호출 실패';
      return {
        success: false,
        transactionId: '',
        error: errorMessage,
      };
    }
  }
}
