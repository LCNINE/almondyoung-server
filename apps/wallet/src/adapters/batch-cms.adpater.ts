import { Injectable } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { PaymentMethodPort } from '../ports/payment-method.port';
import {
  AgreementFileResponseDto,
  HmsAPI,
  MockHmsAPI,
  RegisterAgreementRequest,
} from 'hms-api-wrapper';
import { ApiClientFactory } from 'hms-api-wrapper';
import {
  ChargeRequest,
  ChargeResult,
  ErrorResult,
} from '../ports/payment-method.port';
import { RefundRequest, RefundResult } from '../ports/payment-method.port';
import { PaymentStatusResult } from '../ports/payment-method.port';
import { WalletTx } from '../shared/database';
import { CreatePaymentMethodDto } from '../shared/types/dto';
import { ulid } from 'ulid';
import * as schema from '../shared/database/schema';
import { DbService } from '@app/db';
import { getTsid } from 'tsid-ts';
export class PaymentMethodResult {
  paymentMethodId: string;
  status: 'PENDING' | 'ACTIVE' | 'FAILED';
}

export class ConsentResult {
  success: boolean;
  rawResponse: any;
}

export class MemberStatusResult {
  status: 'PENDING' | 'REGISTERED' | 'FAILED';
  registeredAt?: Date;
}

@Injectable()
export class BatchCmsAdapter implements PaymentMethodPort {
  private readonly logger = new Logger(BatchCmsAdapter.name);
  private readonly hmsApi: HmsAPI | MockHmsAPI;

  constructor(private readonly dbService: DbService<typeof schema>) {
    this.hmsApi = ApiClientFactory.createFromEnv();
    this.logger.log(
      `BatchCmsAdapter 초기화 완료 - ${process.env.USE_MOCK === 'true' ? 'Mock' : 'Real'} 서버 사용`,
    );
  }

  /** ---------------- 공통 Port 구현 ---------------- */

  async charge(request: ChargeRequest): Promise<ChargeResult | ErrorResult> {
    this.logger.log(
      `BatchCMS 결제 요청: ${request.invoiceId}, 금액=${request.amount}`,
    );
    try {
      const result = await this.hmsApi.withdrawals.request({
        memberId: request.memberId,
        callAmount: request.amount,
        paymentDate: request.paymentDate,
        transactionId: getTsid().toString(),
      });

      const status: 'AUTHORIZED' | 'FAILED' = [
        '출금대기',
        '출금중',
        '출금성공',
      ].includes(result.payment.status)
        ? 'AUTHORIZED'
        : 'FAILED';

      return {
        success: true,
        transactionId: result.payment.transactionId,
        status,
        rawResponse: result,
      };
    } catch (error) {
      return {
        success: false,
        transactionId: '',
        status: 'FAILED',
        rawResponse: error,
        error: error instanceof Error ? error.message : 'HMS API 호출 실패',
      };
    }
  }

  refund(request: RefundRequest): Promise<RefundResult> {
    this.logger.log(
      `BatchCMS 환불 요청: ${request.transactionId}, 금액=${request.amount}`,
    );
    return Promise.resolve({
      success: true,
      refundId: `REFUND-${Date.now()}`,
      status: 'SUCCESS',
      message: '환불 요청이 기록되었습니다 (mock)',
      rawResponse: {},
    });
  }

  async getPaymentStatus(transactionId: string): Promise<PaymentStatusResult> {
    this.logger.log(`BatchCMS 결제 상태 조회: ${transactionId}`);
    try {
      const result = await this.hmsApi.withdrawals.get(transactionId);
      let status: PaymentStatusResult['status'] = 'REQUESTED';
      if (['출금성공', '처리완료'].includes(result.payment.status))
        status = 'CAPTURED';
      else if (['출금실패', '실패'].includes(result.payment.status))
        status = 'FAILED';
      else if (result.payment.status === '취소') status = 'CANCELLED';

      return {
        transactionId: result.payment.transactionId,
        status,
        amount: result.payment.callAmount,
        rawResponse: result,
      };
    } catch (error) {
      return { transactionId, status: 'FAILED', amount: 0, rawResponse: error };
    }
  }

  //   async verify(providerMethodId: string): Promise<boolean> {
  //     this.logger.log(`BatchCMS 결제수단 검증: ${providerMethodId}`);
  //     return true; // TODO: 실제 HMS API 붙이면 변경
  //   }

  //   async deactivate(providerMethodId: string): Promise<void> {
  //     this.logger.log(`BatchCMS 결제수단 비활성화: ${providerMethodId}`);
  //     // TODO: HMS API 해지 처리
  //   }

  /** ---------------- BNPL 전용 기능 (Port에 없음) ---------------- */

  async registerMemberBNPL(
    dto: CreatePaymentMethodDto,
    tx: WalletTx,
  ): Promise<PaymentMethodResult> {
    this.logger.log(`BatchCMS 회원 등록: ${dto.userId}`);
    const hmsResponse = await this.hmsApi.members.create({
      memberId: getTsid().toString(),
      memberName: dto.methodName,
      payerName: dto.methodName,
      paymentKind: 'CMS',
      paymentCompany: 'BATCHCMS',
      paymentNumber: ulid(),
      payerNumber: ulid(),
      phone: '01012345678',
    });

    const [method] = await tx
      .insert(schema.paymentMethod)
      .values({
        id: hmsResponse.member.memberId,
        userId: dto.userId,
        methodType: 'BNPL',
        methodName: dto.methodName,
        status: 'PENDING',
      })
      .returning();

    return {
      paymentMethodId: method.id,
      status: method.status as 'PENDING' | 'ACTIVE' | 'FAILED',
    };
  }

  async submitConsentBNPL(
    request: RegisterAgreementRequest,
  ): Promise<{ success: boolean; rawResponse: AgreementFileResponseDto }> {
    this.logger.log(`BatchCMS 동의자료 제출: ${request.memberId}`);
    const result = await this.hmsApi.agreements.register(
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

  async getMemberStatusBNPL(memberId: string): Promise<MemberStatusResult> {
    const result = await this.hmsApi.members.get(memberId);
    if (result.member.status === '신청완료') {
      return { status: 'REGISTERED', registeredAt: new Date() };
    }
    if (result.member.status === '신청대기') {
      return { status: 'PENDING' };
    }
    return { status: 'FAILED' };
  }
}
