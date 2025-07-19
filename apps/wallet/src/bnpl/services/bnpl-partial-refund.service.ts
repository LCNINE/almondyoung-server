import { Injectable, Logger } from '@nestjs/common';
import { BnplAccountService } from './bnpl-account.service';
import { HmsBnplService } from './hms-bnpl.service';
import { BnplPaymentService } from './bnpl-payment.service';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import * as schema from '../../shared/schemas/schema';
import { ulid } from 'ulid';

/**
 * BNPL 부분환불 서비스
 * 
 * 주요 기능:
 * 1. 환불 금액 검증
 * 2. 원본 결제 상태 확인 (HMS에서 처리완료 상태인지)
 * 3. 환불 가능 금액 확인
 * 4. HMS 연동을 통한 환불 처리
 * 5. BNPL 잔액 업데이트 (차감)
 * 6. 환불 거래 기록 생성
 */
@Injectable()
export class BnplPartialRefundService {
  private readonly logger = new Logger(BnplPartialRefundService.name);

  constructor(
    private readonly accountService: BnplAccountService,
    private readonly hmsBnplService: HmsBnplService,
    private readonly bnplPaymentService: BnplPaymentService,
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {
    this.logger.log('💰 BNPL 부분환불 서비스 초기화 완료');
  }

  /**
   * 부분환불 처리
   */
  async processPartialRefund(request: PartialRefundRequest): Promise<PartialRefundResult> {
    const correlationId = ulid();
    this.logger.log(`[${correlationId}] 부분환불 처리 시작: ${request.originalPaymentId}, 금액: ${request.refundAmount}`);

    try {
      // 1. 입력 검증
      await this.validateRefundRequest(request);

      // 2. 원본 결제 정보 조회
      const originalPayment = await this.getOriginalPaymentInfo(request.originalPaymentId);
      if (!originalPayment) {
        throw new Error(`원본 결제를 찾을 수 없습니다: ${request.originalPaymentId}`);
      }

      // 3. BNPL 계정 조회
      const account = await this.accountService.getAccountById(originalPayment.accountId);
      if (!account) {
        throw new Error(`BNPL 계정을 찾을 수 없습니다: ${originalPayment.accountId}`);
      }

      // 4. HMS에서 원본 결제 상태 확인 (처리완료 상태인지)
      const hmsPaymentStatus = await this.hmsBnplService.checkCaptureStatus(originalPayment.hmsTransactionId);
      if (!hmsPaymentStatus.isCaptured) {
        throw new Error(`원본 결제가 아직 처리완료 상태가 아닙니다. 현재 상태: ${hmsPaymentStatus.status}`);
      }

      // 5. 환불 금액 검증
      const validationResult = await this.validateRefundAmount(originalPayment, request.refundAmount);
      if (!validationResult.isValid) {
        throw new Error(validationResult.errorMessage);
      }

      // 6. HMS를 통한 환불 처리 (현재는 로그만 - 목업서버에 환불 API 없음)
      const hmsRefundResult = await this.hmsBnplService.processRefund(
        originalPayment.hmsTransactionId,
        request.refundAmount,
        request.reason
      );

      // 7. Payment Event 생성 (환불 거래 추적)
      const refundPaymentResult = await this.bnplPaymentService.requestPayment({
        invoiceId: originalPayment.invoiceId || `REFUND-INV-${correlationId}`,
        paymentMethodId: originalPayment.paymentMethodId,
        amount: -request.refundAmount, // 환불은 음수로 기록
        actor: request.requestedBy || 'USER',
        metadata: {
          type: 'PARTIAL_REFUND',
          originalPaymentId: request.originalPaymentId,
          originalHmsTransactionId: originalPayment.hmsTransactionId,
          refundReason: request.reason,
          correlationId,
        },
      });

      // 8. BNPL Transaction 기록 생성 (Event Sourcing: 이벤트만 생성, 잔액은 실시간 계산)
      const bnplRefundTransaction = await this.createBnplRefundTransaction({
        accountId: account.id,
        type: 'PARTIAL_REFUND',
        amount: request.refundAmount,
        originalPaymentId: request.originalPaymentId,
        paymentEventId: refundPaymentResult.id,
        hmsRefundId: hmsRefundResult.refundId,
        reason: request.reason,
        requestedBy: request.requestedBy,
        correlationId,
      });

      // 9. 새로운 잔액 계산 (Event Sourcing)
      const newBalance = account.currentBalance - request.refundAmount;

      this.logger.log(`[${correlationId}] 부분환불 처리 완료: ${bnplRefundTransaction.id}`);

      return {
        success: true,
        refundId: bnplRefundTransaction.id,
        hmsRefundId: hmsRefundResult.refundId,
        paymentEventId: refundPaymentResult.id,
        refundAmount: request.refundAmount,
        newBalance,
        originalPaymentId: request.originalPaymentId,
        correlationId,
      };

    } catch (error) {
      this.logger.error(`[${correlationId}] 부분환불 처리 실패: ${error.message}`);
      
      // TODO: 실패 시 롤백 처리
      
      return {
        success: false,
        errorMessage: error.message,
        correlationId,
      };
    }
  }

  /**
   * 부분환불 요청 검증
   */
  private async validateRefundRequest(request: PartialRefundRequest): Promise<void> {
    if (!request.originalPaymentId) {
      throw new Error('원본 결제 ID가 필요합니다');
    }

    if (!request.refundAmount || request.refundAmount <= 0) {
      throw new Error('환불 금액은 0보다 커야 합니다');
    }

    if (request.refundAmount > 10000000) { // 1천만원 제한
      throw new Error('환불 금액이 너무 큽니다 (최대 1천만원)');
    }

    if (!request.reason || request.reason.trim().length < 5) {
      throw new Error('환불 사유는 5자 이상 입력해야 합니다');
    }

    // 소수점 2자리까지만 허용
    if (Math.round(request.refundAmount * 100) !== request.refundAmount * 100) {
      throw new Error('환불 금액은 소수점 2자리까지만 허용됩니다');
    }
  }

  /**
   * 원본 결제 정보 조회
   */
  private async getOriginalPaymentInfo(paymentId: string): Promise<any> {
    // TODO: 실제 Payment Event 조회 로직 구현
    // 현재는 더미 데이터 반환
    this.logger.log(`원본 결제 정보 조회: ${paymentId}`);
    
    return {
      id: paymentId,
      accountId: 'account-123',
      hmsTransactionId: 'HMS-TX-123',
      amount: 50000,
      status: 'COMPLETED',
      invoiceId: 'INV-123',
      paymentMethodId: 'PM-123',
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * 환불 금액 검증
   */
  private async validateRefundAmount(originalPayment: any, refundAmount: number): Promise<ValidationResult> {
    // 1. 환불 금액이 원본 결제 금액을 초과하는지 확인
    if (refundAmount > originalPayment.amount) {
      return {
        isValid: false,
        errorMessage: `환불 금액이 원본 결제 금액을 초과할 수 없습니다. 원본: ${originalPayment.amount}원, 요청: ${refundAmount}원`,
      };
    }

    // 2. 이미 환불된 금액 확인 (TODO: 실제 환불 이력 조회)
    const alreadyRefunded = 0; // TODO: 실제 환불 이력에서 계산
    const availableRefundAmount = originalPayment.amount - alreadyRefunded;
    
    if (refundAmount > availableRefundAmount) {
      return {
        isValid: false,
        errorMessage: `환불 가능한 금액을 초과했습니다. 환불가능: ${availableRefundAmount}원, 요청: ${refundAmount}원`,
      };
    }

    // 3. 최소 환불 금액 확인 (100원)
    if (refundAmount < 100) {
      return {
        isValid: false,
        errorMessage: '최소 환불 금액은 100원입니다',
      };
    }

    // 4. 환불 시간 제한 확인 (예: 결제 후 30일 이내)
    const paymentDate = new Date(originalPayment.createdAt);
    const daysSincePayment = (Date.now() - paymentDate.getTime()) / (1000 * 60 * 60 * 24);
    
    if (daysSincePayment > 30) {
      return {
        isValid: false,
        errorMessage: '결제 후 30일이 지나 환불할 수 없습니다',
      };
    }

    return {
      isValid: true,
    };
  }

  /**
   * 새로운 잔액 계산 (환불 시 차감)
   */
  private calculateNewBalance(currentBalance: number, refundAmount: number, type: 'REFUND'): number {
    // 환불이므로 잔액에서 차감
    return Math.round((currentBalance - refundAmount) * 100) / 100;
  }

  /**
   * BNPL 환불 Transaction 기록 생성 (Event Sourcing)
   */
  private async createBnplRefundTransaction(data: CreateBnplRefundTransactionData): Promise<any> {
    this.logger.log(`[DB] BNPL 환불 Transaction 생성 시작: ${data.accountId}, 금액: ${data.amount}`);

    // 환불은 CREDIT 타입 (잔액 차감)
    const invoiceId = data.originalPaymentId || `REFUND-INV-${Date.now()}`;

    const [bnplTransaction] = await this.dbService.db
      .insert(schema.bnplTransaction)
      .values({
        bnplAccountId: data.accountId,
        invoiceId,
        transactionType: 'CREDIT', // 환불은 CREDIT (잔액 차감)
        status: 'CAPTURED',
        amount: data.amount,
      })
      .returning();

    this.logger.log(`[DB] BNPL 환불 Transaction 생성 완료: ${bnplTransaction.id}`);
    
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
interface PartialRefundRequest {
  originalPaymentId: string;
  refundAmount: number;
  reason: string;
  requestedBy?: string;
}

interface PartialRefundResult {
  success: boolean;
  refundId?: string;
  hmsRefundId?: string;
  paymentEventId?: string;
  refundAmount?: number;
  newBalance?: number;
  originalPaymentId?: string;
  correlationId: string;
  errorMessage?: string;
}

interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
}

interface CreateBnplRefundTransactionData {
  accountId: string;
  type: 'PARTIAL_REFUND';
  amount: number;
  originalPaymentId: string;
  paymentEventId: string;
  hmsRefundId: string;
  reason: string;
  requestedBy?: string;
  correlationId: string;
}