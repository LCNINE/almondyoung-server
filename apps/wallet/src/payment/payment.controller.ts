import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import {
  CreatePaymentDto,
  RefundPaymentDto,
  PartialPaymentDto,
} from './dto/create-payment.dto';
import { CreateBnplPaymentDto } from './dto/create-bnpl-payment.dto';
import { RefundWithPaymentDetails } from './types/payment.types';

/**
 * Controller for handling payment-related endpoints.
 */
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  /**
   * Get all payments (stub, implement as needed)
   */

  /**
   * Create a new payment based on invoice and payment method.
   * @param body Payment creation DTO
   * @returns Payment event result
   */
  @Post()
  async createPayment(@Body() body: CreatePaymentDto) {
    return this.paymentService.createPayment(body);
  }

  /**
   * 특정 userId의 전체 환불 내역 조회
   * GET /payments/refunds?userId=USER_ID
   */
  @Get('refunds')
  async getRefundsByUserId(@Query('userId') userId: string) {
    return this.paymentService.getRefundsByUserId(userId);
  }

  /**
   * 특정 결제 이벤트의 환불 목록 조회
   */
  @Get(':paymentId/refunds')
  async getRefundsByPaymentEventId(@Param('paymentId') paymentId: string) {
    return this.paymentService.getRefundsByPaymentEventId(paymentId);
  }

  /**
   * 특정 결제의 특정 환불 단건 조회
   */
  @Get(':paymentId/refunds/:refundId')
  async getRefund(
    @Param('paymentId') paymentId: string,
    @Param('refundId') refundId: string,
  ) {
    const refunds =
      await this.paymentService.getRefundsByPaymentEventId(paymentId);
    const refund = refunds.find(
      (item: RefundWithPaymentDetails) => item.id === refundId,
    );
    if (!refund) {
      throw new NotFoundException(
        `Refund with ID ${refundId} not found for payment ${paymentId}`,
      );
    }
    return refund;
  }

  /**
   * 결제 단건 조회 (가장 포괄적인 경로, 마지막에 위치)
   */
  @Get(':id')
  getPayment(@Param('id') id: string): string {
    // TODO: Implement payment detail retrieval
    console.log(`Fetching payment with id: ${id}`);
    return 'Payment';
  }

  /**
   * Create a refund for a payment.
   * If amount is provided, creates a partial refund.
   * If amount is not provided, creates a full refund.
   * @param paymentId Payment event ID
   * @param dto RefundPaymentDto
   * @returns Refund event result
   */
  @Post(':paymentId/refunds')
  async refundPayment(
    @Param('paymentId') paymentId: string,
    @Body() dto: RefundPaymentDto,
  ) {
    if (dto.amount) {
      return this.paymentService.refundPartialPayment({
        ...dto,
        paymentEventId: paymentId,
        amount: dto.amount, // Ensure amount is a number
      });
    } else {
      return this.paymentService.refundFullPayment({
        ...dto,
        paymentEventId: paymentId,
      });
    }
  }

  /**
   * 부분결제 처리
   * POST /payments/partial
   */
  @Post('partial')
  async partialPayment(@Body() dto: PartialPaymentDto) {
    return this.paymentService.partialPayment(dto);
  }

  /**
   * BNPL 결제 처리
   * POST /payments/bnpl
   */
  @Post('bnpl')
  async createBnplPayment(@Body() dto: CreateBnplPaymentDto) {
    return this.paymentService.createBnplPayment(dto, 'USER');
  }
}
