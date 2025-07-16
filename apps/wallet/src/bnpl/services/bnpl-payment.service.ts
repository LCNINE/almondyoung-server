import { Injectable, Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { PaymentService } from '../../payment/payment.service';
import { PaymentRequestDto, PaymentCaptureDto } from '../dto/payment-request.dto';
import { bnplTransaction, bnplAccount } from '../schema';
import * as schema from '../schema';
import { DbService, InjectDb } from '@app/db';

/**
 * BNPL 결제 서비스
 * 
 * 주요 역할:
 * 1. BNPL 결제 요청 처리
 * 2. BNPL 결제 캡처 처리
 * 3. BNPL 결제 실패 처리
 * 4. 이벤트 소싱 패턴에 따라 결제 이벤트 생성
 */
@Injectable()
export class BnplPaymentService {
  private readonly logger = new Logger(BnplPaymentService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly paymentService: PaymentService,
  ) {
    this.logger.log('🚀 BNPL 결제 서비스 초기화 완료');
  }

  /**
   * BNPL 결제 요청 처리
   * 
   * 플로우:
   * 1. BNPL 계정 조회
   * 2. 결제 이벤트 생성 (REQUESTED)
   * 3. BNPL 거래 기록 생성 (AUTHORIZED)
   * 
   * @param dto 결제 요청 DTO (이미 검증됨)
   * @returns 결제 요청 결과
   */
  async requestPayment(dto: PaymentRequestDto): Promise<{ paymentId: string; transactionId: string }> {
    this.logger.log(`BNPL 결제 요청 시작: ${dto.bnplAccountId}, 금액: ${dto.amount}원`);

    try {
      // 1. BNPL 계정 조회
      const account = await this.dbService.db.query.bnplAccount.findFirst({
        where: eq(bnplAccount.id, dto.bnplAccountId),
      });

      if (!account) {
        throw new Error(`BNPL 계정을 찾을 수 없습니다: ${dto.bnplAccountId}`);
      }

      // 2. 결제 이벤트 생성 (REQUESTED) - DTO 객체로 전달
      const paymentRequestDto = {
        invoiceId: dto.invoiceId,
        paymentMethodId: account.paymentMethodId,
        amount: dto.amount,
        actor: 'USER' as const,
      };

      const paymentEvent = await this.paymentService.requestPayment(paymentRequestDto);

      // 3. BNPL 거래 기록 생성 (AUTHORIZED)
      const transactionId = nanoid();
      const [transaction] = await this.dbService.db.insert(bnplTransaction)
        .values({
          id: transactionId,
          bnplAccountId: dto.bnplAccountId,
          invoiceId: dto.invoiceId,
          transactionType: 'DEBIT',
          status: 'AUTHORIZED',
          amount: dto.amount,
          createdAt: new Date(),
        })
        .returning();

      this.logger.log(`BNPL 결제 요청 완료: paymentId=${paymentEvent.id}, transactionId=${transactionId}`);

      return {
        paymentId: paymentEvent.id,
        transactionId,
      };
    } catch (error) {
      this.logger.error(`BNPL 결제 요청 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * BNPL 결제 캡처 처리
   * 
   * 플로우:
   * 1. 결제 이벤트 조회
   * 2. 결제 성공 이벤트 생성 (SUCCESS)
   * 3. BNPL 거래 상태 업데이트 (CAPTURED)
   * 4. BNPL 계정 잔액 업데이트
   * 
   * @param dto 결제 캡처 DTO
   * @returns 결제 캡처 결과
   */
  async capturePayment(dto: PaymentCaptureDto): Promise<{ eventId: string }> {
    this.logger.log(`BNPL 결제 캡처 시작: ${dto.paymentId}`);

    try {
      // 1. 결제 이벤트 조회
      const paymentEvent = await this.paymentService.getPaymentEvent(dto.paymentId);

      if (!paymentEvent) {
        throw new Error(`결제 이벤트를 찾을 수 없습니다: ${dto.paymentId}`);
      }

      if (paymentEvent.status !== 'REQUESTED') {
        throw new Error(`결제 상태가 요청 상태가 아닙니다: ${paymentEvent.status}`);
      }

      // 2. 결제 성공 이벤트 생성 (SUCCESS) - DTO 객체로 전달
      const paymentSuccessDto = {
        invoiceId: paymentEvent.invoiceId,
        paymentMethodId: paymentEvent.paymentMethodId,
        amount: dto.amount || paymentEvent.amount,
        pgTransactionId: `bnpl_capture_${Date.now()}`,
        pgResponse: JSON.stringify({ status: 'success', timestamp: new Date() }),
        actor: 'SCHEDULER' as const,
      };

      const successEvent = await this.paymentService.successPayment(paymentSuccessDto);

      // 3. BNPL 거래 상태 업데이트 (CAPTURED)
      // 해당 인보이스 ID와 관련된 AUTHORIZED 상태의 거래 찾기
      const transactions = await this.dbService.db.query.bnplTransaction.findMany({
        where: (bnplTransaction, { and, eq }) => and(
          eq(bnplTransaction.invoiceId, paymentEvent.invoiceId),
          eq(bnplTransaction.status, 'AUTHORIZED')
        ),
      });

      if (transactions.length === 0) {
        throw new Error(`AUTHORIZED 상태의 BNPL 거래를 찾을 수 없습니다: invoiceId=${paymentEvent.invoiceId}`);
      }

      // 거래 상태 업데이트
      await this.dbService.db.update(bnplTransaction)
        .set({ status: 'CAPTURED' })
        .where(eq(bnplTransaction.id, transactions[0].id));

      // 4. BNPL 계정 잔액 업데이트
      // 결제 방법 ID로 BNPL 계정 찾기
      const bnplAccounts = await this.dbService.db.query.bnplAccount.findMany({
        where: eq(bnplAccount.paymentMethodId, paymentEvent.paymentMethodId),
      });

      if (bnplAccounts.length > 0) {
        const account = bnplAccounts[0];
        const newBalance = account.currentBalance + Number(paymentEvent.amount);

        await this.dbService.db.update(bnplAccount)
          .set({ currentBalance: newBalance })
          .where(eq(bnplAccount.id, account.id));

        this.logger.log(`BNPL 계정 잔액 업데이트: ${account.id}, 새 잔액: ${newBalance}원`);
      }

      this.logger.log(`BNPL 결제 캡처 완료: eventId=${successEvent.id}`);

      return {
        eventId: successEvent.id,
      };
    } catch (error) {
      this.logger.error(`BNPL 결제 캡처 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * BNPL 결제 실패 처리
   * 
   * 플로우:
   * 1. 결제 이벤트 조회
   * 2. 결제 실패 이벤트 생성 (FAILED)
   * 3. BNPL 거래 상태 업데이트 (VOIDED)
   * 
   * @param paymentId 결제 ID
   * @param reason 실패 사유
   * @returns 결제 실패 결과
   */
  async failPayment(paymentId: string, reason: string): Promise<{ eventId: string }> {
    this.logger.log(`BNPL 결제 실패 처리 시작: ${paymentId}, 사유: ${reason}`);

    try {
      // 1. 결제 이벤트 조회
      const paymentEvent = await this.paymentService.getPaymentEvent(paymentId);

      if (!paymentEvent) {
        throw new Error(`결제 이벤트를 찾을 수 없습니다: ${paymentId}`);
      }

      // 2. 결제 실패 이벤트 생성 (FAILED) - DTO 객체로 전달
      const paymentFailureDto = {
        invoiceId: paymentEvent.invoiceId,
        paymentMethodId: paymentEvent.paymentMethodId,
        amount: paymentEvent.amount,
        pgResponse: JSON.stringify({ status: 'failed', reason, timestamp: new Date() }),
        actor: 'ADMIN' as const, // SYSTEM 대신 ADMIN 사용
      };

      const failedEvent = await this.paymentService.failPayment(paymentFailureDto);

      // 3. BNPL 거래 상태 업데이트 (VOIDED)
      // 해당 인보이스 ID와 관련된 AUTHORIZED 상태의 거래 찾기
      const transactions = await this.dbService.db.query.bnplTransaction.findMany({
        where: (bnplTransaction, { and, eq }) => and(
          eq(bnplTransaction.invoiceId, paymentEvent.invoiceId),
          eq(bnplTransaction.status, 'AUTHORIZED')
        ),
      });

      if (transactions.length > 0) {
        // 거래 상태 업데이트
        await this.dbService.db.update(bnplTransaction)
          .set({ status: 'VOIDED' })
          .where(eq(bnplTransaction.id, transactions[0].id));
      }

      this.logger.log(`BNPL 결제 실패 처리 완료: eventId=${failedEvent.id}`);

      return {
        eventId: failedEvent.id,
      };
    } catch (error) {
      this.logger.error(`BNPL 결제 실패 처리 오류: ${error.message}`);
      throw error;
    }
  }

  /**
   * 결제 이벤트 조회
   * 
   * @param paymentId 결제 ID
   * @returns 결제 이벤트
   */
  async getPaymentEvent(paymentId: string) {
    return this.paymentService.getPaymentEvent(paymentId);
  }

  /**
   * 인보이스 ID로 결제 이벤트 조회
   * 
   * @param invoiceId 인보이스 ID
   * @returns 결제 이벤트 목록
   */
  async getPaymentEventsByInvoiceId(invoiceId: number) {
    return this.paymentService.getPaymentEventsByInvoiceId(invoiceId);
  }
}