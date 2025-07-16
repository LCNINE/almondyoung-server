import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import * as schema from '../schema';
import { payment, paymentEvent } from '../../shared/schemas/payment.schema';
import { PaymentRequestDto, PaymentCaptureDto } from '../dto/payment-request.dto';

/**
 * BNPL 결제 서비스
 * 
 * 주요 기능:
 * 1. BNPL 결제 요청 처리
 * 2. 결제 이벤트 기록
 * 3. 결제 상태 관리
 */
@Injectable()
export class BnplPaymentService {
  private readonly logger = new Logger(BnplPaymentService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {
    this.logger.log('🚀 BNPL 결제 서비스 초기화 완료');
  }

  /**
   * BNPL 결제 요청 처리
   * 1. payment_event 테이블에 REQUESTED 이벤트 생성
   * 2. bnpl_transaction 테이블에 거래 기록
   */
  async requestPayment(dto: PaymentRequestDto): Promise<{ 
    success: boolean; 
    paymentId: string;
    eventId: string;
    transactionId: string;
  }> {
    this.logger.log(`BNPL 결제 요청 시작: ${dto.bnplAccountId}, 금액: ${dto.amount}원`);

    return await this.dbService.db.transaction(async (tx) => {
      // 1. BNPL 계정 조회 및 검증
      const bnplAccount = await tx.query.bnplAccount.findFirst({
        where: eq(schema.bnplAccount.id, dto.bnplAccountId),
      });

      if (!bnplAccount) {
        throw new BadRequestException('BNPL 계정을 찾을 수 없습니다.');
      }

      if (bnplAccount.status !== 'ACTIVE') {
        throw new BadRequestException(`BNPL 계정이 활성 상태가 아닙니다: ${bnplAccount.status}`);
      }

      // 2. 신용 한도 확인
      const availableCredit = Number(bnplAccount.creditLimit) - Number(bnplAccount.currentBalance);
      if (dto.amount > availableCredit) {
        throw new BadRequestException(`신용 한도 초과: 가용 한도 ${availableCredit}원, 요청 금액 ${dto.amount}원`);
      }

      // 3. payment 테이블에 결제 정보 생성
      const paymentId = nanoid();
      const [newPayment] = await tx
        .insert(payment)
        .values({
          id: paymentId,
          invoiceId: dto.invoiceId,
          paymentMethodId: bnplAccount.paymentMethodId,
          amount: dto.amount,
          status: 'PENDING',
          paymentType: 'BNPL',
          description: dto.description || `BNPL 결제 - ${dto.invoiceId}`,
          metadata: dto.metadata ? JSON.stringify(dto.metadata) : null,
        })
        .returning();

      // 4. payment_event 테이블에 REQUESTED 이벤트 생성
      const eventId = nanoid();
      const [newEvent] = await tx
        .insert(paymentEvent)
        .values({
          id: eventId,
          paymentId: paymentId,
          eventType: 'PAYMENT_REQUESTED',
          amount: dto.amount,
          actor: 'USER',
          metadata: dto.metadata ? JSON.stringify(dto.metadata) : null,
        })
        .returning();

      // 5. bnpl_transaction 테이블에 거래 기록
      const transactionId = nanoid();
      const [newTransaction] = await tx
        .insert(schema.bnplTransaction)
        .values({
          id: transactionId,
          bnplAccountId: dto.bnplAccountId,
          invoiceId: dto.invoiceId,
          transactionType: 'DEBIT',
          status: 'AUTHORIZED',
          amount: dto.amount,
        })
        .returning();

      this.logger.log(`BNPL 결제 요청 완료: paymentId=${paymentId}, eventId=${eventId}, transactionId=${transactionId}`);

      return {
        success: true,
        paymentId,
        eventId,
        transactionId,
      };
    });
  }

  /**
   * BNPL 결제 실패 처리
   * 1. payment_event 테이블에 FAILED 이벤트 생성
   * 2. payment 테이블의 상태 업데이트
   * 3. bnpl_transaction 테이블의 상태 업데이트
   */
  async failPayment(paymentId: string, reason: string): Promise<{ 
    success: boolean; 
    eventId: string;
  }> {
    this.logger.log(`BNPL 결제 실패 처리 시작: ${paymentId}, 사유: ${reason}`);

    return await this.dbService.db.transaction(async (tx) => {
      // 1. payment 정보 조회
      const paymentInfo = await tx.query.payment.findFirst({
        where: eq(payment.id, paymentId),
      });

      if (!paymentInfo) {
        throw new BadRequestException('결제 정보를 찾을 수 없습니다.');
      }

      if (paymentInfo.status !== 'PENDING') {
        throw new BadRequestException(`결제가 이미 처리되었습니다: ${paymentInfo.status}`);
      }

      // 2. payment_event 테이블에 FAILED 이벤트 생성
      const eventId = nanoid();
      await tx
        .insert(paymentEvent)
        .values({
          id: eventId,
          paymentId: paymentId,
          eventType: 'PAYMENT_FAILED',
          amount: Number(paymentInfo.amount),
          actor: 'SYSTEM',
          reason: reason,
        });

      // 3. payment 테이블의 상태 업데이트
      await tx
        .update(payment)
        .set({
          status: 'FAILED',
          updatedAt: new Date(),
        })
        .where(eq(payment.id, paymentId));

      // 4. bnpl_transaction 테이블의 상태 업데이트
      // 해당 payment와 연결된 bnpl_transaction 찾기
      const transaction = await tx.query.bnplTransaction.findFirst({
        where: and(
          eq(schema.bnplTransaction.invoiceId, paymentInfo.invoiceId),
          eq(schema.bnplTransaction.status, 'AUTHORIZED')
        ),
      });

      if (transaction) {
        await tx
          .update(schema.bnplTransaction)
          .set({
            status: 'VOIDED',
          })
          .where(eq(schema.bnplTransaction.id, transaction.id));
      }

      this.logger.log(`BNPL 결제 실패 처리 완료: paymentId=${paymentId}, eventId=${eventId}`);

      return {
        success: true,
        eventId,
      };
    });
  }

  /**
   * BNPL 결제 캡처 처리
   * 1. payment_event 테이블에 CAPTURED 이벤트 생성
   * 2. payment 테이블의 상태 업데이트
   * 3. bnpl_transaction 테이블의 상태 업데이트
   * 4. bnpl_account 테이블의 currentBalance 업데이트
   */
  async capturePayment(dto: PaymentCaptureDto): Promise<{ 
    success: boolean; 
    eventId: string;
  }> {
    this.logger.log(`BNPL 결제 캡처 시작: ${dto.paymentId}`);

    return await this.dbService.db.transaction(async (tx) => {
      // 1. payment 정보 조회
      const paymentInfo = await tx.query.payment.findFirst({
        where: eq(payment.id, dto.paymentId),
      });

      if (!paymentInfo) {
        throw new BadRequestException('결제 정보를 찾을 수 없습니다.');
      }

      if (paymentInfo.status !== 'PENDING') {
        throw new BadRequestException(`결제가 이미 처리되었습니다: ${paymentInfo.status}`);
      }

      // 캡처 금액 결정 (지정된 금액 또는 전체 금액)
      const captureAmount = dto.amount || Number(paymentInfo.amount);

      // 2. payment_event 테이블에 CAPTURED 이벤트 생성
      const eventId = nanoid();
      await tx
        .insert(paymentEvent)
        .values({
          id: eventId,
          paymentId: dto.paymentId,
          eventType: 'PAYMENT_CAPTURED',
          amount: captureAmount,
          actor: 'SYSTEM',
        });

      // 3. payment 테이블의 상태 업데이트
      await tx
        .update(payment)
        .set({
          status: 'COMPLETED',
          updatedAt: new Date(),
          completedAt: new Date(),
        })
        .where(eq(payment.id, dto.paymentId));

      // 4. bnpl_transaction 테이블의 상태 업데이트
      // 해당 payment와 연결된 bnpl_transaction 찾기
      const transaction = await tx.query.bnplTransaction.findFirst({
        where: and(
          eq(schema.bnplTransaction.invoiceId, paymentInfo.invoiceId),
          eq(schema.bnplTransaction.status, 'AUTHORIZED')
        ),
      });

      if (!transaction) {
        throw new BadRequestException('BNPL 거래 정보를 찾을 수 없습니다.');
      }

      await tx
        .update(schema.bnplTransaction)
        .set({
          status: 'CAPTURED',
        })
        .where(eq(schema.bnplTransaction.id, transaction.id));

      // 5. bnpl_account 테이블의 currentBalance 업데이트
      await tx
        .update(schema.bnplAccount)
        .set({
          currentBalance: Number(transaction.amount) + Number(transaction.amount),
          updatedAt: new Date(),
        })
        .where(eq(schema.bnplAccount.id, transaction.bnplAccountId));

      this.logger.log(`BNPL 결제 캡처 완료: paymentId=${dto.paymentId}, eventId=${eventId}, amount=${captureAmount}`);

      return {
        success: true,
        eventId,
      };
    });
  }
}