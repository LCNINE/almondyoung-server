import { Injectable, Logger } from '@nestjs/common';
import { BnplAccountService } from './bnpl-account.service';
import { HmsBnplService } from './hms-bnpl.service';
import { BnplPaymentService } from './bnpl-payment.service';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import * as schema from '../../shared/schemas/schema';
import { ulid } from 'ulid';

/**
 * BNPL 부분결제 서비스
 * 
 * 주요 기능:
 * 1. 부분결제 금액 검증
 * 2. 신용 한도 확인
 * 3. HMS 연동을 통한 실제 결제 처리
 * 4. BNPL 잔액 업데이트
 * 5. 거래 기록 생성
 */
@Injectable()
export class BnplPartialPaymentService {
  private readonly logger = new Logger(BnplPartialPaymentService.name);

  constructor(
    private readonly accountService: BnplAccountService,
    private readonly hmsBnplService: HmsBnplService,
    private readonly bnplPaymentService: BnplPaymentService,
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {
    this.logger.log('💳 BNPL 부분결제 서비스 초기화 완료');
  }

  /**
   * 부분결제 처리
   */
  async processPartialPayment(request: PartialPaymentRequest): Promise<PartialPaymentResult> {
    const correlationId = ulid();
    this.logger.log(`[${correlationId}] 부분결제 처리 시작: ${request.accountId}, 금액: ${request.amount}`);

    try {
      // 1. 입력 검증
      await this.validatePaymentRequest(request);

      // 2. BNPL 계정 조회 및 검증
      const account = await this.accountService.getAccountById(request.accountId);
      if (!account) {
        throw new Error(`BNPL 계정을 찾을 수 없습니다: ${request.accountId}`);
      }

      // 3. 결제 금액 검증 (신용 한도 확인)
      const validationResult = await this.validatePaymentAmount(account, request.amount);
      if (!validationResult.isValid) {
        throw new Error(validationResult.errorMessage);
      }

      // 4. HMS를 통한 실제 결제 처리
      const hmsTransactionId = `PARTIAL-${Date.now()}-${correlationId}`;

      // HMS 출금 요청 (부분결제)
      const hmsResult = await this.hmsBnplService.requestWithdrawal({
        transactionId: hmsTransactionId,
        memberId: account.userId, // HMS에서는 userId를 memberId로 사용
        paymentDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''), // YYYYMMDD
        callAmount: request.amount,
        invoiceId: request.invoiceId,
        description: request.description || '부분결제',
      });

      // 5. Payment Event 생성 (HMS 거래 추적)
      const paymentResult = await this.bnplPaymentService.requestPayment({
        invoiceId: request.invoiceId || `INV-${correlationId}`,
        paymentMethodId: request.paymentMethodId || account.paymentMethodId,
        amount: request.amount,
        actor: 'USER',
        metadata: {
          type: 'PARTIAL_PAYMENT',
          hmsTransactionId,
          correlationId,
        },
      });

      // 6. BNPL Transaction 기록 생성 (Event Sourcing)
      const bnplTransaction = await this.createBnplTransaction({
        accountId: request.accountId,
        type: 'PARTIAL_PAYMENT',
        amount: request.amount,
        paymentEventId: paymentResult.id,
        hmsTransactionId,
        invoiceId: request.invoiceId,
        description: request.description,
        correlationId,
      });

      // 7. 현재 잔액 계산 (Event Sourcing - 실시간 계산)
      const newBalance = account.currentBalance + request.amount;

      this.logger.log(`[${correlationId}] 부분결제 처리 완료: ${bnplTransaction.id}`);

      return {
        success: true,
        transactionId: bnplTransaction.id,
        hmsTransactionId,
        paymentEventId: paymentResult.id,
        amount: request.amount,
        newBalance,
        correlationId,
      };

    } catch (error) {
      this.logger.error(`[${correlationId}] 부분결제 처리 실패: ${error.message}`);

      // TODO: 실패 시 롤백 처리 (BnplTransactionManager에서 처리)

      return {
        success: false,
        errorMessage: error.message,
        correlationId,
      };
    }
  }

  /**
   * 부분결제 요청 검증
   */
  private async validatePaymentRequest(request: PartialPaymentRequest): Promise<void> {
    if (!request.accountId) {
      throw new Error('계정 ID가 필요합니다');
    }

    if (!request.amount || request.amount <= 0) {
      throw new Error('결제 금액은 0보다 커야 합니다');
    }

    if (request.amount > 10000000) { // 1천만원 제한
      throw new Error('결제 금액이 너무 큽니다 (최대 1천만원)');
    }

    // 소수점 2자리까지만 허용
    if (Math.round(request.amount * 100) !== request.amount * 100) {
      throw new Error('결제 금액은 소수점 2자리까지만 허용됩니다');
    }
  }

  /**
   * 결제 금액 검증 (신용 한도 확인)
   */
  private async validatePaymentAmount(account: any, amount: number): Promise<ValidationResult> {
    // 1. 계정 상태 확인
    if (account.status !== 'ACTIVE') {
      return {
        isValid: false,
        errorMessage: `계정이 활성 상태가 아닙니다: ${account.status}`,
      };
    }

    // 2. 사용 가능한 신용 한도 확인 (Event Sourcing - 실시간 계산)
    const availableCredit = account.approvedLimit - account.currentBalance;

    if (amount > availableCredit) {
      return {
        isValid: false,
        errorMessage: `사용 가능한 신용 한도를 초과했습니다. 사용가능: ${availableCredit}원, 요청: ${amount}원`,
      };
    }

    // 3. 최소 결제 금액 확인 (1,000원)
    if (amount < 1000) {
      return {
        isValid: false,
        errorMessage: '최소 결제 금액은 1,000원입니다',
      };
    }

    return {
      isValid: true,
    };
  }

  /**
   * 새로운 잔액 계산 (임시 - 나중에 BnplBalanceCalculator로 교체)
   */
  private calculateNewBalance(currentBalance: number, paymentAmount: number): number {
    // 간단한 덧셈 (나중에 정밀한 decimal 계산으로 교체)
    return Math.round((currentBalance + paymentAmount) * 100) / 100;
  }

  /**
   * BNPL Transaction 기록 생성 (Event Sourcing)
   */
  private async createBnplTransaction(data: CreateBnplTransactionData): Promise<any> {
    this.logger.log(`[DB] BNPL Transaction 생성 시작: ${data.accountId}, 금액: ${data.amount}`);

    const transactionType = data.type === 'PARTIAL_PAYMENT' ? 'DEBIT' : 'CREDIT';
    const invoiceId = data.invoiceId || `INV-${Date.now()}`;

    const [bnplTransaction] = await this.dbService.db
      .insert(schema.bnplTransaction)
      .values({
        bnplAccountId: data.accountId,
        invoiceId,
        transactionType,
        status: 'CAPTURED',
        amount: data.amount,
      })
      .returning();

    this.logger.log(`[DB] BNPL Transaction 생성 완료: ${bnplTransaction.id}`);

    return {
      id: bnplTransaction.id,
      accountId: bnplTransaction.bnplAccountId,
      invoiceId: bnplTransaction.invoiceId,
      transactionType: bnplTransaction.transactionType,
      status: bnplTransaction.status,
      amount: Number(bnplTransaction.amount),
      createdAt: bnplTransaction.createdAt,
    };
  }
}

// 타입 정의들
interface PartialPaymentRequest {
  accountId: string;
  amount: number;
  paymentMethodId?: string;
  invoiceId?: string;
  description?: string;
}

interface PartialPaymentResult {
  success: boolean;
  transactionId?: string;
  hmsTransactionId?: string;
  paymentEventId?: string;
  amount?: number;
  newBalance?: number;
  correlationId: string;
  errorMessage?: string;
}

interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
}

interface CreateBnplTransactionData {
  accountId: string;
  type: 'PARTIAL_PAYMENT' | 'PARTIAL_REFUND';
  amount: number;
  paymentEventId: string;
  hmsTransactionId: string;
  invoiceId?: string;
  description?: string;
  correlationId: string;
}