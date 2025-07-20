import { Injectable, Logger } from '@nestjs/common';
import { PaymentProcessingPort } from '../../payment/port/payment-processing.port';
import { MethodManagementPort } from '../../payment-method/port/method-management.port';
import { MockHmsAPI } from 'hms-api-wrapper';
import * as paymentZod from '../../shared/zod/payment.zod';
import { CreatePaymentMethodPayload } from '../../shared/zod/payment-method.zod';
import tsid from 'tsid-ts';

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
  async registerMember(request: CreatePaymentMethodPayload): Promise<any> {
    this.logger.log(`BatchCMS 회원 등록: ${request.userId}`);
    // CreatePaymentMethodPayload → BatchCMS 회원등록 DTO로 변환
    const memberData = {
      memberId: request.userId,
      memberName: request.methodName, // 예시: methodName을 memberName으로 사용
      payerName: request.methodName,
      paymentKind: 'CMS' as const,
      paymentCompany: request.institutionCode,
      paymentNumber: '1234567890', // 실제로는 추가 정보 필요
      payerNumber: '9001011234',
      phone: '01012345678',
      email: `${request.userId}@example.com`,
    };
    try {
      const result = await this.mockApi.members.create(memberData);
      return {
        memberId: result.member.memberId,
        status: 'SUCCESS',
        message: '회원 등록 성공',
        rawResponse: result,
      };
    } catch (error) {
      return {
        memberId: '',
        status: 'FAILURE',
        message: (error as Error).message,
        rawResponse: {},
      };
    }
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
