import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { CreatePaymentDto, RefundPaymentDto, FullRefundPaymentDto, PartialRefundPaymentDto, PartialPaymentDto } from './dto/create-payment.dto';

/**
 * Controller for handling payment-related endpoints.
 */
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  /**
   * Get all payments (stub, implement as needed)
   */
  @Get()
  async getPayments() {
    // TODO: Implement payment list retrieval
    return 'Payments';
  }

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
  @Get(':id/refunds')
  async getRefundsByPaymentEventId(@Param('id') paymentEventId: string) {
    return this.paymentService.getRefundsByPaymentEventId(paymentEventId);
  }

  /**
   * Get a specific refund by ID (stub, implement as needed)
   */
  @Get('refunds/:id')
  async getRefund(@Param('id') id: string) {
    // TODO: Implement refund detail retrieval
    return 'Refund';
  }

  /**
   * 결제 단건 조회 (가장 포괄적인 경로, 마지막에 위치)
   */
  @Get(':id')
  async getPayment(@Param('id') id: string) {
    // TODO: Implement payment detail retrieval
    return 'Payment';
  }

  /**
   * Create a full refund for a payment.
   * @param paymentEventId Payment event ID
   * @param dto FullRefundPaymentDto
   * @returns Refund event result
   */
  @Post(':id/refund/full')
  async fullRefund(
    @Param('id') paymentEventId: string,
    @Body() dto: FullRefundPaymentDto,
  ) {
    dto.paymentEventId = paymentEventId;
    return this.paymentService.refundFullPayment(dto);
  }

  /**
   * Create a partial refund for a payment.
   * @param paymentEventId Payment event ID
   * @param dto PartialRefundPaymentDto
   * @returns Refund event result
   */
  @Post(':id/refund/partial')
  async partialRefund(
    @Param('id') paymentEventId: string,
    @Body() dto: PartialRefundPaymentDto,
  ) {
    dto.paymentEventId = paymentEventId;
    return this.paymentService.refundPartialPayment(dto);
  }

  /**
   * 부분결제 처리
   * POST /payments/partial
   */
  @Post('partial')
  async partialPayment(@Body() dto: PartialPaymentDto) {
    return this.paymentService.partialPayment(dto);
  }
}
