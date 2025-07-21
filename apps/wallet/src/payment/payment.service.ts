import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  ForbiddenException,
} from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../shared/schemas/schema';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { PaymentProcessingPort } from './port/payment-processing.port';
import { ProcessPaymentDto } from './dto/process-payment.dto';

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
    // ✅ 팩토리 대신, Port(계약서)를 직접 주입받습니다.
    @Inject(PaymentProcessingPort)
    private readonly paymentProcessor: PaymentProcessingPort,
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {}

  /**
   * 결제 프로세스를 총괄하는 메인 메서드
   * @param payload 결제에 필요한 정보 (청구서 ID, 결제수단 ID)
   */
  async processPayment(payload: ProcessPaymentDto) {
    const { invoiceId, paymentMethodId } = payload;

    // 여러 DB 작업을 하나의 원자적 단위로 묶기 위해 트랜잭션을 사용합니다.
    return this.dbService.db.transaction(async (tx) => {
      // --- 1. 사전 검증 (Guard Clauses) ---
      this.logger.log(`결제 처리 시작: Invoice ID ${invoiceId}`);

      const invoice = await tx.query.invoice.findFirst({
        where: eq(schema.invoice.id, invoiceId),
      });

      if (!invoice) {
        throw new NotFoundException('존재하지 않는 청구서입니다.');
      }
      if (invoice.status === 'PAID' || invoice.status === 'CANCELLED') {
        throw new BadRequestException('이미 처리되었거나 폐기된 청구서입니다.');
      }

      // --- 2. 🚨 임시 조치: 청구서에서 userId 가져오기 ---
      // TODO: 추후 인증 Guard 구현 시, 이 라인을 삭제하고 Controller에서 직접 userId를 받아야 합니다.
      const userId = invoice.userId;
      this.logger.warn(`임시로 Invoice에서 UserId를 사용합니다: ${userId}`);

      // --- 3. 결제수단 검증 ---
      const paymentMethod = await tx.query.paymentMethod.findFirst({
        where: eq(schema.paymentMethod.id, paymentMethodId),
      });
      if (!paymentMethod) {
        throw new NotFoundException('존재하지 않는 결제수단입니다.');
      }

      // --- 🚨 userId 소유권 검증 로직 (주석 처리) ---
      // TODO: 추후 인증(Auth) Guard가 구현되면 아래 주석을 반드시 해제해야 합니다.
      /*
      if (paymentMethod.userId !== userId) {
        throw new ForbiddenException('본인의 결제수단만 사용할 수 있습니다.');
      }
      */

      const bnplAccount = await tx.query.bnplAccount.findFirst({
        where: eq(schema.bnplAccount.userId, userId),
      });
      if (!bnplAccount) {
        throw new NotFoundException('BNPL 계정이 존재하지 않습니다.');
      }

      const batchCmsMethod = await tx.query.batchCmsMethod.findFirst({
        where: eq(schema.batchCmsMethod.id, paymentMethod.id),
      });
      if (!batchCmsMethod) {
        throw new NotFoundException(
          '해당 결제수단에 연결된 BNPL PG사 정보가 없습니다.',
        );
      }

      // --- 3. 어댑터에 결제 요청 위임 ---
      const paymentDate = this.calculateNextPaymentDate();
      const chargeResult = await this.paymentProcessor.charge({
        memberId: batchCmsMethod.hmsMemberId, // ✅ hmsMemberId를 전달
        invoiceId,
        amount: invoice.amount,
        paymentDate: paymentDate,
      });

      console.log(chargeResult, 'chargeResult');
      // --- 5. 통신 결과 기록 (PaymentEvent) ---
      this.logger.log(`PG사 통신 결과 수신: ${chargeResult.status}`);
      const [paymentEvent] = await tx
        .insert(schema.paymentEvents)
        .values({
          id: ulid(),
          invoiceId: invoice.id,
          paymentMethodId: paymentMethod.id,
          amount: invoice.amount,
          status: chargeResult.status, // 'AUTHORIZED' 또는 'FAILED'
          pgTransactionId: chargeResult.transactionId,
          pgResponse: JSON.stringify(chargeResult.rawResponse),
          actor: 'USER',
          metadata: JSON.stringify({ gateway: chargeResult.gatewayId }),
        })
        .returning();

      if (!chargeResult.success) {
        this.logger.error(`결제 실패: ${chargeResult.transactionId}`);
        // 실패했어도 PaymentEvent는 기록되고, 트랜잭션은 롤백됩니다.
        throw new BadRequestException('결제 요청에 실패했습니다.');
      }

      // --- 6. 성공 시, 내부 상태 업데이트 ---
      this.logger.log(`결제 예약 성공: ${chargeResult.transactionId}`);

      // 6a. 내부 회계 장부 기록 (bnplTransaction)
      await tx.insert(schema.bnplTransaction).values({
        id: ulid(),
        bnplAccountId: bnplAccount.id,
        invoiceId: invoice.id,
        transactionType: 'DEBIT',
        status: 'AUTHORIZED', // PG사와 동일하게 '승인됨(예약됨)' 상태로 기록
        amount: invoice.amount,
      });

      // 6b. 청구서 상태 업데이트
      await tx
        .update(schema.invoice)
        .set({ status: 'PAID' }) // 사용자 경험을 위해 'PAID'로 즉시 처리
        .where(eq(schema.invoice.id, invoiceId));

      this.logger.log(`내부 상태 업데이트 완료: Invoice ID ${invoiceId}`);

      return {
        success: true,
        paymentEventId: paymentEvent.id,
        paymentStatus: chargeResult.status,
      };
    });
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
