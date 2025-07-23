import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../shared/schemas/schema';
import { FINANCIAL_TRANSACTION_STATUS, PAYMENT_METHOD_STATUS, INVOICE_STATUS } from '../shared/schemas/schema';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { ProcessPaymentDto, PaymentDetailDto } from './dto/process-payment.dto';
import { BnplAccountService } from '../bnpl/services/bnpl-account.service';
import { PointService } from '../point/point.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PaymentAuthorizedEvent } from './events/payment.events';

// 이 서비스가 컨트롤러로부터 받을 요청 데이터 타입 정의
interface ProcessPaymentPayload {
  invoiceId: string;
  paymentMethodId: string;
}

/**
 * 결제(Payment) 도메인 서비스
 * - 역할: 결제 프로세스를 총괄 지휘하고, 결과를 DB에 기록합니다.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly bnplAccountService: BnplAccountService,
    private readonly pointService: PointService,
    private readonly eventEmitter: EventEmitter2,
  ) { }

  /**
   * 결제 프로세스를 총괄하는 메인 메서드 (단일 결제 + 혼합 결제 지원)
   * @param payload 결제에 필요한 정보 (청구서 ID, 결제 정보 배열)
   */
  async processPayment(payload: ProcessPaymentDto) {
    const { invoiceId, payments, paymentMethodId } = payload;

    // 하위 호환성: 기존 단일 결제 방식 지원
    let paymentDetails: PaymentDetailDto[];
    if (payments && payments.length > 0) {
      // 새로운 혼합 결제 방식
      paymentDetails = payments;
    } else if (paymentMethodId) {
      // 기존 단일 결제 방식 (하위 호환성)
      paymentDetails = [{
        methodType: 'BNPL',
        amount: 0, // 전액을 의미 (나중에 invoice 금액으로 설정)
        paymentMethodId: paymentMethodId
      }];
    } else {
      throw new BadRequestException('결제 정보가 필요합니다. (payments 배열 또는 paymentMethodId)');
    }

    // 여러 DB 작업을 하나의 원자적 단위로 묶기 위해 트랜잭션을 사용합니다.
    const result = await this.dbService.db.transaction(async (tx) => {
      // --- 1. 사전 검증 (Guard Clauses) ---
      this.logger.log(`혼합 결제 처리 시작: Invoice ID ${invoiceId}`);

      const invoice = await tx.query.invoice.findFirst({
        where: eq(schema.invoice.id, invoiceId),
      });

      if (!invoice) {
        throw new NotFoundException('존재하지 않는 청구서입니다.');
      }
      if (invoice.status === INVOICE_STATUS.PAID || invoice.status === INVOICE_STATUS.CANCELLED) {
        throw new BadRequestException('이미 처리되었거나 폐기된 청구서입니다.');
      }

      // --- 2. 🚨 임시 조치: 청구서에서 userId 가져오기 ---
      const userId = invoice.userId;
      this.logger.warn(`임시로 Invoice에서 UserId를 사용합니다: ${userId}`);

      const invoiceAmount = Number(invoice.amount);

      // --- 3. 하위 호환성: 기존 단일 결제 방식에서 전액 설정 ---
      if (paymentDetails.length === 1 && paymentDetails[0].amount === 0) {
        paymentDetails[0].amount = invoiceAmount;
      }

      // --- 4. 결제 금액 검증 ---
      const totalPaymentAmount = paymentDetails.reduce((sum, payment) => sum + payment.amount, 0);
      if (totalPaymentAmount !== invoiceAmount) {
        throw new BadRequestException(
          `결제 금액이 청구서 금액과 일치하지 않습니다. (청구서: ${invoiceAmount}원, 결제: ${totalPaymentAmount}원)`
        );
      }

      // --- 5. 각 결제수단별 처리 ---
      const processedPayments: Array<{
        methodType: string;
        amount: number;
        paymentMethodId?: string;
        status: string;
      }> = [];
      let bnplAmount = 0;
      let bnplPaymentMethodId = '';

      for (const paymentDetail of paymentDetails) {
        if (paymentDetail.methodType === 'REWARD_POINT') {
          // 포인트 사용 처리
          this.logger.log(`포인트 사용: ${paymentDetail.amount} 포인트`);
          
          const pointResult = await this.pointService.redeemPoints({
            userId,
            amount: paymentDetail.amount,
            reason: `청구서 ${invoiceId} 결제`,
            relatedEventId: invoiceId,
          });

          if (!pointResult.success) {
            throw new BadRequestException(`포인트 사용 실패: ${pointResult.message}`);
          }

          processedPayments.push({
            methodType: 'REWARD_POINT',
            amount: paymentDetail.amount,
            status: 'COMPLETED',
          });

        } else if (paymentDetail.methodType === 'BNPL') {
          // BNPL 결제 처리
          if (!paymentDetail.paymentMethodId) {
            throw new BadRequestException('BNPL 결제수단 ID가 필요합니다.');
          }

          // BNPL 결제수단 검증
          const paymentMethod = await tx.query.paymentMethod.findFirst({
            where: eq(schema.paymentMethod.id, paymentDetail.paymentMethodId),
          });
          if (!paymentMethod) {
            throw new NotFoundException('존재하지 않는 BNPL 결제수단입니다.');
          }
          if (paymentMethod.status !== PAYMENT_METHOD_STATUS.ACTIVE) {
            throw new BadRequestException('활성화된 BNPL 결제수단이 아닙니다.');
          }

          // BNPL 계정 검증
          const bnplAccount = await tx.query.bnplAccount.findFirst({
            where: eq(schema.bnplAccount.userId, userId),
          });
          if (!bnplAccount) {
            throw new NotFoundException('BNPL 계정이 존재하지 않습니다.');
          }

          // 신용 한도 검증
          const availableCredit = await this.bnplAccountService.getAvailableCredit(userId);
          if (paymentDetail.amount > availableCredit) {
            this.logger.warn(`BNPL 신용 한도 초과: 사용자 ${userId}, 요청 ${paymentDetail.amount}, 사용가능 ${availableCredit}`);
            throw new BadRequestException(`BNPL 신용 한도를 초과했습니다. (사용 가능액: ${availableCredit}원)`);
          }

          bnplAmount = paymentDetail.amount;
          bnplPaymentMethodId = paymentDetail.paymentMethodId;

          processedPayments.push({
            methodType: 'BNPL',
            amount: paymentDetail.amount,
            paymentMethodId: paymentDetail.paymentMethodId,
            status: 'AUTHORIZED',
          });

          this.logger.log(`BNPL 내부 승인: ${paymentDetail.amount}원`);
        }
      }

      // --- 6. Invoice 상태를 PAID로 업데이트 ---
      await tx.update(schema.invoice)
        .set({ 
          status: INVOICE_STATUS.PAID,
          updatedAt: new Date()
        })
        .where(eq(schema.invoice.id, invoiceId));

      // --- 7. 이벤트 발행 준비 ---
      const paymentEventId = ulid();

      this.logger.log(`혼합 결제 승인 완료: Invoice ID ${invoiceId}, 총 ${totalPaymentAmount}원 → Invoice 상태: PAID`);

      return {
        success: true,
        paymentEventId,
        paymentStatus: 'AUTHORIZED',
        userId,
        invoice,
        processedPayments,
        bnplAmount,
        bnplPaymentMethodId,
      };
    });

    // 🎯 트랜잭션 완료 후 이벤트 발행 (Event Sourcing)
    // BNPL 결제가 있는 경우에만 payment.authorized 이벤트 발행
    if (result.bnplAmount > 0 && result.bnplPaymentMethodId) {
      this.eventEmitter.emit(
        'payment.authorized',
        new PaymentAuthorizedEvent(
          result.paymentEventId,
          invoiceId,
          result.bnplPaymentMethodId,
          result.bnplAmount,
          result.userId,
          new Date(),
        ),
      );
      this.logger.log(`BNPL 결제 이벤트 발행: ${result.bnplAmount}원`);
    }

    // 혼합 결제 완료 이벤트 발행 (전체 결제 완료 알림)
    this.eventEmitter.emit(
      'payment.completed',
      {
        paymentEventId: result.paymentEventId,
        invoiceId,
        userId: result.userId,
        totalAmount: Number(result.invoice.amount),
        processedPayments: result.processedPayments,
        timestamp: new Date(),
      }
    );

    return {
      success: result.success,
      paymentEventId: result.paymentEventId,
      paymentStatus: result.paymentStatus,
    };
  }

  /**
   * 다음 정산일(출금일)을 계산하는 헬퍼 메서드
   */
  private calculateNextPaymentDate(): string {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 15);
    const year = nextMonth.getFullYear();
    const month = (nextMonth.getMonth() + 1).toString().padStart(2, '0');
    const day = nextMonth.getDate().toString().padStart(2, '0');
    return `${year}${month}${day}`;
  }
}
