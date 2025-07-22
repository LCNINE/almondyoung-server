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
import { ProcessPaymentDto } from './dto/process-payment.dto';
import { BnplAccountService } from '../bnpl/services/bnpl-account.service';

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
  ) { }

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
      if (invoice.status === INVOICE_STATUS.PAID || invoice.status === INVOICE_STATUS.CANCELLED) {
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

      // ✅ 중요: 이 결제수단이 'ACTIVE' 상태인지 확인하는 것이 유일한 관문입니다.
      if (paymentMethod.status !== PAYMENT_METHOD_STATUS.ACTIVE) {
        throw new BadRequestException('활성화된 BNPL 결제수단이 아닙니다.');
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

      // --- 4. ✅ 신용 한도 검증 (새로 추가된 핵심 로직) ---
      const availableCredit = await this.bnplAccountService.getAvailableCredit(userId);
      const purchaseAmount = Number(invoice.amount);

      if (purchaseAmount > availableCredit) {
        this.logger.warn(`신용 한도 초과 시도: 사용자 ${userId}, 요청 금액 ${purchaseAmount}, 사용 가능액 ${availableCredit}`);
        throw new BadRequestException(`신용 한도를 초과했습니다. (사용 가능액: ${availableCredit}원)`);
      }

      // --- ❌ PG사(어댑터) 호출 로직 완전 삭제 ---
      // 외부와 통신 없이, 내부적으로 모든 것을 처리합니다.

      // --- 4. 내부 기록 생성 ---
      // 4a. PaymentEvent 기록 (상태: AUTHORIZED)
      const [paymentEvent] = await tx
        .insert(schema.paymentEvents)
        .values({
          id: ulid(),
          invoiceId: invoice.id,
          paymentMethodId: paymentMethod.id,
          amount: invoice.amount,
          status: FINANCIAL_TRANSACTION_STATUS.AUTHORIZED, // ✅ '내부 승인 완료' 상태로 즉시 기록
          actor: 'USER',
        })
        .returning();

      // 4b. bnplTransaction 기록 (상태: AUTHORIZED)
      await tx.insert(schema.bnplTransaction).values({
        id: ulid(),
        bnplAccountId: bnplAccount.id,
        invoiceId: invoice.id,
        transactionType: 'DEBIT',
        status: FINANCIAL_TRANSACTION_STATUS.AUTHORIZED, // ✅ '내부 승인 완료' 상태로 즉시 기록
        amount: invoice.amount,
      });

      // 4c. 청구서 상태 PAID로 업데이트
      await tx
        .update(schema.invoice)
        .set({ status: INVOICE_STATUS.PAID })
        .where(eq(schema.invoice.id, invoiceId));

      this.logger.log(`내부 결제 승인 완료: Invoice ID ${invoiceId}`);

      return {
        success: true,
        paymentEventId: paymentEvent.id,
        paymentStatus: 'AUTHORIZED',
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
