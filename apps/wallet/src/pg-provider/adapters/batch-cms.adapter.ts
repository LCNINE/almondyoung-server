import { Injectable, Logger } from '@nestjs/common';
import { PaymentProcessingPort } from '../../payment/port/payment-processing.port';
import { MethodManagementPort } from '../../payment-method/port/method-management.port';
import { MockHmsAPI } from 'hms-api-wrapper';
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
  async charge(request: paymentZod.Event['Request']): Promise<{
    transactionId: string;
    status: 'PENDING' | 'SUCCESS' | 'FAILURE';
    message?: string;
    rawResponse: any;
    capturedAt?: Date;
  }> {
    this.logger.log(
      `BatchCMS 결제 요청: ${request.invoiceId}, 금액: ${request.amount}`,
    );
    try {
      const result = await this.mockApi.withdrawals.request({
        memberId: tsid.getTsid().toString(),
        callAmount: request.amount,
        paymentDate: new Date().toISOString().split('T')[0],
        transactionId: tsid.getTsid().toString(),
      });
      return {
        transactionId: result.payment.transactionId,
        status: result.payment.status === '신청' ? 'PENDING' : 'SUCCESS',
        rawResponse: result,
      };
    } catch (error) {
      return {
        transactionId: '',
        status: 'FAILURE',
        message: (error as Error).message,
        rawResponse: {},
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
        case '신청':
          standardStatus = 'REQUESTED';
          break;
        case '처리완료':
          standardStatus = 'CAPTURED';
          break;
        case '취소':
          standardStatus = 'CANCELLED';
          break;
        case '실패':
          standardStatus = 'FAILED';
          break;
        default:
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
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date(),
        termsUrl: 'https://www.batchcms.com/terms',
      })
      .returning();

    // API 응답 반환
    return hmsResponse;
  }
  async getMemberStatus(memberId: string): Promise<{
    status: 'PENDING' | 'REGISTERED' | 'FAILED';
    registeredAt?: Date;
  }> {
    this.logger.log(`BatchCMS 회원 상태 조회: ${memberId}`);
    try {
      const result = await this.mockApi.members.get(memberId);
      // 임시로 3일 경과 시 등록 완료로 처리
      const memberCreatedAt = new Date();
      const daysSinceCreation = Math.floor(
        (Date.now() - memberCreatedAt.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysSinceCreation >= 3) {
        return {
          status: 'REGISTERED',
          registeredAt: new Date(
            memberCreatedAt.getTime() + 3 * 24 * 60 * 60 * 1000,
          ),
        };
      }
      return {
        status: 'PENDING',
      };
    } catch (error) {
      return {
        status: 'FAILED',
      };
    }
  }
}
