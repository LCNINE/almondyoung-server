import { Injectable, Logger } from '@nestjs/common';
import {
  ChargeResult,
  PaymentProcessingPort,
} from '../../payment/port/payment-processing.port';
import { MethodManagementPort } from '../../payment-method/port/method-management.port';
import {
  AgreementFileResponseDto,
  MockHmsAPI,
  RegisterAgreementRequest,
} from 'hms-api-wrapper';
import * as paymentZod from '../../shared/zod/payment.zod';
import { CreatePaymentMethodPayload } from '../../shared/zod/payment-method.zod';
import tsid from 'tsid-ts';
import { WalletTx } from '../../shared/types';
import * as schema from '../../shared/schemas/schema';
import { ulid } from 'ulid';

@Injectable()
export class BatchCmsAdapter
  implements PaymentProcessingPort, MethodManagementPort
{
  private readonly logger = new Logger(BatchCmsAdapter.name);
  private readonly mockApi: MockHmsAPI;

  constructor() {
    this.mockApi = new MockHmsAPI({
      swKey: process.env.HMS_SW_KEY || 'mock-sw',
      custKey: process.env.HMS_CUST_KEY || 'mock-cust',
      isTest: process.env.NODE_ENV !== 'production',
    });
    this.logger.log('BatchCmsAdapter 초기화 완료');
  }

  // 결제 처리
  async charge(request: {
    invoiceId: string;
    amount: number;
    paymentDate: string;
    memberId: string;
  }): Promise<ChargeResult> {
    this.logger.log(
      `BatchCMS 결제 요청: ${request.invoiceId}, 금액: ${request.amount}`,
    );

    console.log(request, 'requwat');
    try {
      const result = await this.mockApi.withdrawals.request({
        memberId: request.memberId,
        callAmount: request.amount,
        paymentDate: request.paymentDate,
        transactionId: tsid.getTsid().toString(),
      });
      return {
        success: true,
        transactionId: result.payment.transactionId,
        status:
          result.payment.status === '출금대기' ||
          result.payment.status === '출금중' ||
          result.payment.status === '출금실패' ||
          result.payment.status === '출금성공'
            ? 'AUTHORIZED'
            : result.payment.status === '출금대기'
              ? 'AUTHORIZED'
              : result.payment.status === '출금중'
                ? 'AUTHORIZED'
                : result.payment.status === '출금실패'
                  ? 'FAILED'
                  : 'FAILED',
        rawResponse: result,
      };
    } catch (error) {
      return {
        success: false,
        transactionId: '',
        status: 'FAILED',
        rawResponse: error,
      };
    }
  }

  async refund(request: {
    transactionId: string;
    amount: number;
    reason: string;
    metadata?: Record<string, any>;
  }): Promise<{
    refundId: string;
    status: 'PENDING' | 'SUCCESS' | 'FAILURE';
    message?: string;
    rawResponse: any;
  }> {
    this.logger.log(
      `BatchCMS 환불 요청: ${request.transactionId}, 금액: ${request.amount}`,
    );
    await Promise.resolve();
    return {
      refundId: `REFUND-${Date.now()}`,
      status: 'SUCCESS',
      message: '환불 요청이 기록되었습니다 (mock)',
      rawResponse: {},
    };
  }

  async getPaymentStatus(transactionId: string): Promise<{
    transactionId: string;
    status: 'REQUESTED' | 'CAPTURED' | 'CANCELLED' | 'FAILED';
    amount: number;
    capturedAt?: Date;
    rawResponse: any;
  }> {
    this.logger.log(`BatchCMS 결제 상태 조회: ${transactionId}`);
    try {
      const result = await this.mockApi.withdrawals.get(transactionId);
      let standardStatus: 'REQUESTED' | 'CAPTURED' | 'CANCELLED' | 'FAILED';
      switch (result.payment.status) {
        case '출금대기':
        case '신청': // 하위 호환성
          standardStatus = 'REQUESTED';
          break;
        case '출금성공':
        case '처리완료': // 하위 호환성
          standardStatus = 'CAPTURED';
          break;
        case '출금실패':
        case '실패': // 하위 호환성
          standardStatus = 'FAILED';
          break;
        case '취소':
          standardStatus = 'CANCELLED';
          break;
        default:
          this.logger.warn(`알 수 없는 HMS 결제 상태: ${result.payment.status}`);
          standardStatus = 'REQUESTED';
      }
      return {
        transactionId: result.payment.transactionId,
        status: standardStatus,
        amount: result.payment.callAmount,
        rawResponse: result,
      };
    } catch (error) {
      return {
        transactionId,
        status: 'FAILED',
        amount: 0,
        rawResponse: {},
      };
    }
  }

  // 회원 등록 (타입 정합성 유지)
  async registerMember(
    request: CreatePaymentMethodPayload,
    tx: WalletTx, // 트랜잭션 객체를 직접 받음
    paymentMethod: typeof schema.paymentMethod.$inferSelect, // 생성된 paymentMethod의 ID를 받음
  ): Promise<any> {
    this.logger.log(`BatchCMS 회원 등록: ${request.userId}`);

    // 1. 외부 API 호출
    const hmsResponse = await this.mockApi.members.create({
      memberId: paymentMethod.id,
      memberName: request.methodName,
      payerName: request.methodName,
      paymentKind: 'CMS',
      paymentCompany: 'BATCHCMS',
      paymentNumber: ulid(),
      payerNumber: ulid(),
      phone: '01012345678',
    });

    // 2. ✅ 어댑터가 직접 batchCmsMethod 테이블에 기록!
    //    이 로직이 서비스에서 어댑터로 이동함.
    await tx
      .insert(schema.batchCmsMethod)
      .values({
        id: paymentMethod.id,
        paymentMethodId: paymentMethod.id,
        hmsMemberId: hmsResponse.member.memberId,
        creditLimit: 0,
        approvedLimit: 0,
        billingCycleDay: 1,
        // status 컬럼 제거됨 - paymentMethod.status를 유일한 신뢰의 원천으로 사용
        createdAt: new Date(),
        updatedAt: new Date(),
        termsUrl: 'https://www.batchcms.com/terms',
      })
      .returning();

    // API 응답 반환
    return hmsResponse;
  }

  async submitConsent(
    request: RegisterAgreementRequest,
  ): Promise<{ success: boolean; rawResponse: AgreementFileResponseDto }> {
    this.logger.log(`BatchCMS 동의자료 제출: ${request.memberId}`);
    const result = await this.mockApi.agreements.register(
      'default-cust',
      request.memberId,
      {
        file: request.file as Buffer,
        filename: request.filename,
      },
    );
    return {
      success: true,
      rawResponse: result,
    };
  }

  async getMemberStatus(memberId: string): Promise<{
    status: 'PENDING' | 'REGISTERED' | 'FAILED';
    registeredAt?: Date;
  }> {
    this.logger.log(`BatchCMS 회원 상태 조회: ${memberId}`);
    try {
      const result = await this.mockApi.members.get(memberId);

      // HMS API 응답의 한국어 상태를 우리 시스템 상태로 변환
      switch (result.member.status) {
        case '신청완료':
          return {
            status: 'REGISTERED',
            registeredAt: new Date(),
          };
        case '신청대기':
          return {
            status: 'PENDING',
          };
        default:
          this.logger.warn(`알 수 없는 HMS 상태: ${result.member.status}`);
          return {
            status: 'PENDING',
          };
      }
    } catch (error) {
      this.logger.error(`BatchCMS 회원 상태 조회 실패: ${memberId}`, error);
      return {
        status: 'FAILED',
      };
    }
  }
}
