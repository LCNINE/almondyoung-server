import { Injectable, Logger } from '@nestjs/common';
import { MockHmsAPI } from 'hms-api-wrapper';
import {
  PaymentProcessingPort,
  MethodManagementPort,
  PaymentRequest,
  PaymentResponse,
  RefundRequest,
  RefundResponse,
  MemberRegistrationRequest,
  MemberRegistrationResponse,
  PaymentStatusResponse,
} from '../../bnpl/ports/payment-ports';

/**
 * BatchCMS (HMS) PG 어댑터
 *
 * HMS BatchCMS API와 연동하는 구체적인 구현체
 */
@Injectable()
export class BatchCmsAdapter
  implements PaymentProcessingPort, MethodManagementPort
{
  private readonly logger = new Logger(BatchCmsAdapter.name);
  private readonly mockApi: MockHmsAPI;

  constructor() {
    super();
    this.mockApi = new MockHmsAPI({
      swKey: process.env.HMS_SW_KEY || 'mock-sw',
      custKey: process.env.HMS_CUST_KEY || 'mock-cust',
      isTest: process.env.NODE_ENV !== 'production',
    });
    this.logger.log('BatchCMS 어댑터 초기화 완료');
  }

  /**
   * BatchCMS 출금 요청 (월별 정산용)
   */
  async charge(request: PaymentRequest): Promise<PaymentResponse> {
    this.logger.log(
      `BatchCMS 출금 요청: ${request.orderId}, 금액: ${request.amount}`,
    );

    try {
      const withdrawalData = {
        memberId: request.memberId,
        callAmount: request.amount,
        paymentDate: new Date().toISOString().split('T')[0], // YYYY-MM-DD
        invoiceId: request.orderId,
        description: request.description || 'BNPL 월별 정산',
      };

      const result = await this.mockApi.withdrawals.request(withdrawalData);

      this.logger.log(
        `BatchCMS 출금 요청 성공: ${result.payment.transactionId}`,
      );

      return {
        transactionId: result.payment.transactionId,
        status: result.payment.status === '신청' ? 'PENDING' : 'FAILURE',
        message: result.message || 'BatchCMS 출금 요청 완료',
        rawResponse: result,
        capturedAt: result.payment.capturedAt
          ? new Date(result.payment.capturedAt)
          : undefined,
      };
    } catch (error) {
      this.logger.error(`BatchCMS 출금 요청 실패: ${error.message}`);

      return {
        transactionId: '',
        status: 'FAILURE',
        message: error.message,
        rawResponse: { error: error.message },
      };
    }
  }

  /**
   * BatchCMS 환불 처리
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    this.logger.log(
      `BatchCMS 환불 요청: ${request.transactionId}, 금액: ${request.amount}`,
    );

    try {
      // TODO: 실제 HMS API에 환불 API가 있다면 여기서 호출
      // 현재는 목업서버에 환불 API가 없으므로 로그만 남김
      this.logger.warn('BatchCMS 환불 API는 아직 목업서버에 구현되지 않음');

      return {
        refundId: `REFUND-${Date.now()}`,
        status: 'SUCCESS',
        message: '환불 요청이 기록되었습니다 (목업 환경)',
        rawResponse: {
          originalTransactionId: request.transactionId,
          refundAmount: request.amount,
          reason: request.reason,
          processedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error(`BatchCMS 환불 실패: ${error.message}`);

      return {
        refundId: '',
        status: 'FAILURE',
        message: error.message,
        rawResponse: { error: error.message },
      };
    }
  }

  /**
   * BatchCMS 회원 등록
   */
  async registerMember(
    request: MemberRegistrationRequest,
  ): Promise<MemberRegistrationResponse> {
    this.logger.log(`BatchCMS 회원 등록: ${request.userId}`);

    try {
      const memberData = {
        memberId: request.userId,
        memberName: request.memberName,
        payerName: request.memberName,
        paymentKind: 'CMS' as const,
        paymentCompany: request.paymentCompany,
        paymentNumber: request.paymentNumber,
        payerNumber: '9001011234', // 임시 생년월일
        phone: request.phone || '01012345678',
        email: request.email || `${request.userId}@example.com`,
      };

      const result = await this.mockApi.members.create(memberData);

      this.logger.log(`BatchCMS 회원 등록 성공: ${result.member.memberId}`);

      return {
        memberId: result.member.memberId,
        status: 'SUCCESS',
        message: 'BatchCMS 회원 등록 완료',
        rawResponse: result,
      };
    } catch (error) {
      this.logger.error(`BatchCMS 회원 등록 실패: ${error.message}`);

      return {
        memberId: '',
        status: 'FAILURE',
        message: error.message,
        rawResponse: { error: error.message },
      };
    }
  }

  /**
   * BatchCMS 결제 상태 조회
   */
  async getPaymentStatus(
    transactionId: string,
  ): Promise<PaymentStatusResponse> {
    this.logger.log(`BatchCMS 결제 상태 조회: ${transactionId}`);

    try {
      const response = await fetch(
        `http://localhost:3005/v1/payments/cms/${transactionId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      this.logger.log(
        `BatchCMS 결제 상태 조회 성공: ${transactionId} - ${result.payment.status}`,
      );

      // HMS 상태를 표준 상태로 변환
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
        capturedAt: result.payment.capturedAt
          ? new Date(result.payment.capturedAt)
          : undefined,
        rawResponse: result,
      };
    } catch (error) {
      this.logger.error(
        `BatchCMS 결제 상태 조회 실패: ${transactionId} - ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * BatchCMS 회원 상태 조회
   */
  async getMemberStatus(
    memberId: string,
  ): Promise<{
    status: 'PENDING' | 'REGISTERED' | 'FAILED';
    registeredAt?: Date;
  }> {
    this.logger.log(`BatchCMS 회원 상태 조회: ${memberId}`);

    try {
      const result = await this.mockApi.members.get(memberId);

      // 임시로 3일 경과 시 등록 완료로 처리
      const memberCreatedAt = new Date(result.member.createdAt || Date.now());
      const daysSinceCreation = Math.floor(
        (Date.now() - memberCreatedAt.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (daysSinceCreation >= 3) {
        return {
          status: 'REGISTERED',
          registeredAt: new Date(
            memberCreatedAt.getTime() + 3 * 24 * 60 * 60 * 1000,
          ), // 3일 후
        };
      }

      return {
        status: 'PENDING',
      };
    } catch (error) {
      this.logger.error(
        `BatchCMS 회원 상태 조회 실패: ${memberId} - ${error.message}`,
      );

      return {
        status: 'FAILED',
      };
    }
  }

  /**
   * BatchCMS 연결 상태 확인
   */
  async healthCheck(): Promise<{ status: 'ok' | 'error'; message: string }> {
    try {
      await this.mockApi.healthCheck();

      return {
        status: 'ok',
        message: 'BatchCMS 연결 정상',
      };
    } catch (error) {
      this.logger.error(`BatchCMS 연결 확인 실패: ${error.message}`);

      return {
        status: 'error',
        message: `BatchCMS 연결 실패: ${error.message}`,
      };
    }
  }
}
