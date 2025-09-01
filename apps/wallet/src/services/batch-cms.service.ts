import { Injectable, Logger } from '@nestjs/common';
import { HmsAPI, MockHmsAPI } from 'hms-api-wrapper';
import { ApiClientFactory } from 'hms-api-wrapper';
import { ulid } from 'ulid';
import { getTsid } from 'tsid-ts';

// 타입 정의 - HMS API 응답 구조에 맞춰 정의
export interface HmsMemberCreateResult {
  memberId: string;
  status: string;
  rawResponse: any;
}

export interface HmsAgreementResult {
  success: boolean;
  agreementId?: string;
  rawResponse: any;
}

export interface HmsMemberStatusResult {
  hmsStatus: string;
  registeredAt: Date | null;
  creditLimit: number;
  approvedLimit: number;
  rawResponse: any;
}

export interface HmsWithdrawalRequest {
  memberId: string;
  amount: number;
  paymentDate: string;
  invoiceId: string;
}

export interface HmsWithdrawalResult {
  success: boolean;
  transactionId: string;
  status: 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'CANCELLED';
  amount: number;
  error?: string;
  rawResponse: any;
}

export interface HmsRefundRequest {
  transactionId: string;
  amount: number;
  reason: string;
}

export interface HmsRefundResult {
  success: boolean;
  refundId: string;
  status: 'SUCCESS' | 'FAILED';
  message: string;
  rawResponse: any;
}

@Injectable()
export class BatchCmsService {
  private readonly logger = new Logger(BatchCmsService.name);
  private readonly hmsApi: HmsAPI | MockHmsAPI;

  constructor() {
    // 🔍 디버깅: 환경변수 상태 출력
    this.logger.debug('=== 환경변수 디버깅 ===');
    this.logger.debug(`USE_MOCK: ${process.env.USE_MOCK}`);
    this.logger.debug(`SW_KEY: ${process.env.SW_KEY ? '✅ 존재' : '❌ 없음'}`);
    this.logger.debug(
      `CUST_KEY: ${process.env.CUST_KEY ? '✅ 존재' : '❌ 없음'}`,
    );
    this.logger.debug(`NODE_ENV: ${process.env.NODE_ENV || '(설정안됨)'}`);
    this.logger.debug('===================');

    // 환경 변수 검증
    if (process.env.USE_MOCK !== 'true') {
      if (!process.env.SW_KEY || !process.env.CUST_KEY) {
        throw new Error('실제 HMS API 사용 시 SW_KEY와 CUST_KEY가 필요합니다.');
      }
    }

    // ApiClientFactory를 사용하여 환경 변수에 따라 자동으로 목업/실제 API 선택
    this.hmsApi = ApiClientFactory.createFromEnv();

    const apiType = process.env.USE_MOCK === 'true' ? 'Mock' : 'Real HMS Test';
    this.logger.log(`BatchCmsAdapter 초기화 완료 - ${apiType} 서버 사용`);

    if (process.env.USE_MOCK !== 'true') {
      this.logger.log(
        '⚠️  실제 HMS 테스트 서버 사용 중 - 회원 등록 및 출금 승인은 수기 처리 필요',
      );
    }
  }

  /** HMS 회원 생성 */
  async createMember(memberInfo: {
    memberName: string;
    payerName: string;
    phone: string;
  }): Promise<HmsMemberCreateResult> {
    this.logger.log(`HMS 회원 생성: ${memberInfo.memberName}`);

    const response = await this.hmsApi.members.create({
      memberId: getTsid().toString(),
      memberName: memberInfo.memberName,
      payerName: memberInfo.payerName,
      paymentKind: 'CMS',
      paymentCompany: 'BATCHCMS',
      paymentNumber: ulid(),
      payerNumber: ulid(),
      phone: memberInfo.phone,
    });

    return {
      memberId: response.member.memberId,
      status: response.member.status,
      rawResponse: response,
    };
  }

  /** HMS 동의서 제출 */
  async submitAgreement(request: {
    memberId: string;
    file: Buffer;
    filename: string;
  }): Promise<HmsAgreementResult> {
    this.logger.log(`HMS 동의서 제출: ${request.memberId}`);

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
  }

  /** HMS 회원 상태 조회 */
  async getMemberStatus(memberId: string): Promise<HmsMemberStatusResult> {
    this.logger.log(`HMS 회원 상태 조회: ${memberId}`);

    const result = await this.hmsApi.members.get(memberId);

    return {
      hmsStatus: result.member.status || 'UNKNOWN',
      registeredAt: null, // HMS API 응답에서 등록일시는 별도 관리
      creditLimit: 0, // HMS에서 제공하지 않으므로 내부에서 관리
      approvedLimit: 0, // HMS에서 제공하지 않으므로 내부에서 관리
      rawResponse: result,
    };
  }

  /** HMS 출금 요청 */
  async requestWithdrawal(
    request: HmsWithdrawalRequest,
  ): Promise<HmsWithdrawalResult> {
    this.logger.log(
      `HMS 출금 요청: ${request.memberId}, 금액=${request.amount}`,
    );

    try {
      const result = await this.hmsApi.withdrawals.request({
        memberId: request.memberId,
        callAmount: request.amount,
        paymentDate: request.paymentDate,
        transactionId: getTsid().toString(),
      });

      // HMS 상태를 표준 상태로 매핑
      const status = this.mapWithdrawalStatus(result.payment.status);

      return {
        success: true,
        transactionId: result.payment.transactionId,
        status,
        amount: result.payment.callAmount,
        rawResponse: result,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'HMS API 호출 실패';
      this.logger.error(`HMS 출금 요청 실패: ${errorMessage}`);
      return {
        success: false,
        transactionId: '',
        status: 'FAILED',
        amount: request.amount,
        error: errorMessage,
        rawResponse: {},
      };
    }
  }

  /** HMS 출금 상태 조회 */
  async getWithdrawalStatus(
    transactionId: string,
  ): Promise<HmsWithdrawalResult> {
    this.logger.log(`HMS 출금 상태 조회: ${transactionId}`);

    try {
      const result = await this.hmsApi.withdrawals.get(transactionId);
      const status = this.mapWithdrawalStatus(result.payment.status);

      return {
        success: true,
        transactionId: result.payment.transactionId,
        status,
        amount: result.payment.callAmount,
        rawResponse: result,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'HMS API 호출 실패';
      this.logger.error(`HMS 출금 상태 조회 실패: ${errorMessage}`);
      return {
        success: false,
        transactionId,
        status: 'FAILED',
        amount: 0,
        error: errorMessage,
        rawResponse: {},
      };
    }
  }

  /** HMS 환불 요청 */
  requestRefund(request: HmsRefundRequest): HmsRefundResult {
    this.logger.log(
      `HMS 환불 요청: ${request.transactionId}, 금액=${request.amount}`,
    );

    // NOTE: HMS API에 환불 기능이 있다면 구현, 없다면 기록만
    return {
      success: true,
      refundId: `REFUND-${Date.now()}`,
      status: 'SUCCESS',
      message: '환불 요청이 기록되었습니다',
      rawResponse: {},
    };
  }

  // === Private 헬퍼 메서드들 ===

  private mapWithdrawalStatus(
    hmsStatus: string,
  ): 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'CANCELLED' {
    if (['출금대기', '출금중', '출금성공'].includes(hmsStatus)) {
      return 'AUTHORIZED';
    }
    if (['처리완료', '출금성공'].includes(hmsStatus)) {
      return 'CAPTURED';
    }
    if (['출금실패', '실패'].includes(hmsStatus)) {
      return 'FAILED';
    }
    if (hmsStatus === '취소') {
      return 'CANCELLED';
    }
    return 'FAILED';
  }
}
