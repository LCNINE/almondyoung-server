import { ConflictException, Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { InvoiceService } from '../invoice/invoice.service';
import { PaymentMethodService } from '../payment-method/payment-method.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { paymentEvents } from './schema';
import * as schema from './schema';
import { eq } from 'drizzle-orm';
import { HmsAPI } from 'hms-api-wrapper';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import type { PaymentTransactionRequest } from 'hms-api-wrapper';

@Injectable()
export class PaymentService {
  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly invoiceService: InvoiceService,
    private readonly paymentMethodService: PaymentMethodService,
    private readonly hmsApi: HmsAPI,
  ) {}

  /**
   * 결제를 생성하고 처리하는 메서드
   * @param createPaymentDto 결제 생성 DTO
   * @param actor 결제 요청 주체
   * @returns 생성된 결제 이벤트
   */
  async createPayment(dto: CreatePaymentDto) {
    const invoice = await this.invoiceService.findOne(dto.invoiceId);
    if (!invoice) {
      throw new Error('Invoice not found');
    }

    const paymentMethod = await this.paymentMethodService.findById(dto.paymentMethodId);
    if (!paymentMethod) {
      throw new Error('Payment method not found');
    }

    const invoiceAmount = Number(invoice.amount);
    if (isNaN(invoiceAmount)) {
      throw new Error('Invalid invoice amount');
    }

    try {
      // 1. 결제 요청 생성
      const request: PaymentTransactionRequest = {
        transactionId: `tx_${Date.now()}`,
        memberId: invoice.userId.toString(),
        callAmount: invoiceAmount,
        cardPointFlag: 'N',
      };

      // 2. HMS API를 통한 결제 처리
      const paymentResult = await this.hmsApi.paymentTryansactions.requestTryansaction(request);

      // 3. 결제 결과 검증
      if (paymentResult.payment?.result?.flag !== 'Y') {
        throw new Error(paymentResult.payment?.result?.message || 'Payment failed');
      }

      // 4. 결제 이벤트 저장
      const [paymentEvent] = await this.dbService.db.insert(schema.paymentEvents).values({
        invoiceId: invoice.id,
        paymentMethodId: paymentMethod.id,
        amount: invoice.amount.toString(),
        status: 'SUCCESS',
        pgTransactionId: request.transactionId,
        pgResponse: JSON.stringify(paymentResult),
        actor: 'USER',
      }).returning();

      return paymentEvent;
    } catch (error) {
      // 실패한 결제 이벤트 저장
      const [failedEvent] = await this.dbService.db.insert(schema.paymentEvents).values({
        invoiceId: invoice.id,
        paymentMethodId: paymentMethod.id,
        amount: invoice.amount.toString(),
        status: 'FAILED',
        pgResponse: JSON.stringify(error.response || error.message),
        actor: 'USER',
      }).returning();

      throw error;
    }
  }
}
