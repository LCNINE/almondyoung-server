import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpStatus,
  HttpCode,
  UsePipes,
  ValidationPipe,
  Logger,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import {
  PaymentSessionService,
  PaymentLockService,
  PaymentSessionEventService,
} from '../services';
import {
  CreatePaymentSessionDto,
  UpdatePaymentSessionDto,
  CreatePaymentLockDto,
  ValidatePaymentLockDto,
  RecordEventDto,
  createPaymentSessionSchema,
  updatePaymentSessionSchema,
  createPaymentLockSchema,
  validatePaymentLockSchema,
  recordEventSchema,
} from '../dto';
import {
  PaymentSession,
  PaymentLock,
  PaymentSessionEvent,
  PaymentSessionStatus,

} from '../types';
import { PAYMENT_SESSION_EVENT_TYPE } from '../../shared/schemas/schema';


type StatusEventType = typeof PAYMENT_SESSION_EVENT_TYPE[keyof typeof PAYMENT_SESSION_EVENT_TYPE];


@Controller('payment-sessions')
export class PaymentSessionController {
  private readonly logger = new Logger(PaymentSessionController.name);

  constructor(
    private readonly paymentSessionService: PaymentSessionService,
    private readonly paymentLockService: PaymentLockService,
    private readonly paymentSessionEventService: PaymentSessionEventService,
  ) { }

  /**
   * 새로운 PaymentSession을 생성합니다.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ZodValidationPipe(createPaymentSessionSchema))
  async createPaymentSession(
    @Body() dto: CreatePaymentSessionDto,
  ): Promise<{
    success: boolean;
    data: PaymentSession & { paymentUrl?: string };
    message: string;
  }> {
    this.logger.log(`Creating payment session for user: ${dto.userId}`);

    const session = await this.paymentSessionService.create(dto);

    // PaymentLock 생성 (중복 방지)
    const lock = await this.paymentLockService.createLock({
      paymentSessionId: session.id,
      expiresInMinutes: 15, // 15분 잠금
    });

    // 세션 생성 이벤트 기록
    await this.paymentSessionEventService.recordEvent({
      paymentSessionId: session.id,
      eventType: 'SESSION_CREATED',
      eventData: {
 
        amount: dto.amount,
        currency: dto.currency,
      },
    });

    // 잠금 생성 이벤트 기록
    await this.paymentSessionEventService.recordEvent({
      paymentSessionId: session.id,
      eventType: 'LOCK_CREATED',
      eventData: {
        lockToken: lock.lockToken,
        expiresAt: lock.expiresAt,
      },
    });

    const response = {
      ...session,
      paymentUrl: `${process.env.PAYMENT_UI_URL || 'http://localhost:3000'}/pay/${lock.lockToken}`,
    };

    this.logger.log(`Payment session created successfully: ${session.id}`);

    return {
      success: true,
      data: response,
      message: 'Payment session created successfully',
    };
  }

  /**
   * PaymentSession 상태를 조회합니다.
   */
  @Get(':id')
  async getPaymentSession(
    @Param('id') id: string,
  ): Promise<{
    success: boolean;
    data: PaymentSession | null;
    message: string;
  }> {
    this.logger.log(`Retrieving payment session: ${id}`);

    const session = await this.paymentSessionService.findById(id);

    if (!session) {
      return {
        success: false,
        data: null,
        message: 'Payment session not found',
      };
    }

    return {
      success: true,
      data: session,
      message: 'Payment session retrieved successfully',
    };
  }

  /**
   * 여러 PaymentSession을 조회합니다.
   */
  @Get()
  async getPaymentSessions(
    @Query('userId') userId?: string,
    @Query('status') status?: PaymentSessionStatus,

    @Query('limit') limit?: string,
  ): Promise<{
    success: boolean;
    data: PaymentSession[];
    message: string;
    total: number;
  }> {
    this.logger.log(`Retrieving payment sessions with filters`);

    const sessions = await this.paymentSessionService.findAll(
      userId,
      status,

    );

    // 간단한 페이지네이션 (실제로는 서비스에서 처리하는 것이 좋음)
    const limitNum = limit ? parseInt(limit, 10) : undefined;
    const limitedSessions = limitNum ? sessions.slice(0, limitNum) : sessions;

    return {
      success: true,
      data: limitedSessions,
      message: 'Payment sessions retrieved successfully',
      total: sessions.length,
    };
  }

  /**
   * PaymentSession 상태를 업데이트합니다.
   */
  @Put(':id')
  @UsePipes(new ZodValidationPipe(updatePaymentSessionSchema))
  async updatePaymentSession(
    @Param('id') id: string,
    @Body() dto: UpdatePaymentSessionDto,
  ): Promise<{
    success: boolean;
    data: PaymentSession;
    message: string;
  }> {
    this.logger.log(`Updating payment session: ${id}`);

    const session = await this.paymentSessionService.update(id, dto);

    // 상태 업데이트 이벤트 기록
    if (dto.status) {
      await this.paymentSessionEventService.recordEvent({
        paymentSessionId: id,
        eventType: this.getEventTypeForStatus(dto.status),
        eventData: {
          previousStatus: session.status, // 실제로는 이전 상태를 가져와야 함
          newStatus: dto.status,
          updatedAt: new Date(),
        },
      });
    }

    return {
      success: true,
      data: session,
      message: 'Payment session updated successfully',
    };
  }

  /**
   * PaymentSession을 취소합니다.
   */
  @Delete(':id')
  async cancelPaymentSession(
    @Param('id') id: string,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    this.logger.log(`Cancelling payment session: ${id}`);

    const session = await this.paymentSessionService.updateStatus(id, 'CANCELLED');

    // 취소 이벤트 기록
    await this.paymentSessionEventService.recordEvent({
      paymentSessionId: id,
      eventType: 'PAYMENT_CANCELLED',
      eventData: {
        cancelledAt: new Date(),
        reason: 'Cancelled by user request',
      },
    });

    // 활성 잠금이 있다면 완료 처리
    const activeLock = await this.paymentLockService.findActiveLock(id);
    if (activeLock) {
      await this.paymentLockService.completeLock(activeLock.id);
    }

    return {
      success: true,
      message: 'Payment session cancelled successfully',
    };
  }

  /**
   * PaymentSession의 결제를 캡처합니다.
   */
  @Post(':id/capture')
  async capturePayment(
    @Param('id') id: string,
  ): Promise<{
    success: boolean;
    data: PaymentSession;
    message: string;
  }> {
    this.logger.log(`Capturing payment for session: ${id}`);

    // 캡처 가능한지 확인
    const canCapture = await this.paymentSessionService.canTransitionTo(id, 'CAPTURED');
    if (!canCapture) {
      throw new Error('Payment session cannot be captured');
    }

    const session = await this.paymentSessionService.updateStatus(id, 'CAPTURED');

    // 캡처 이벤트 기록
    await this.paymentSessionEventService.recordEvent({
      paymentSessionId: id,
      eventType: 'PAYMENT_CAPTURED',
      eventData: {
        capturedAt: new Date(),
        amount: session.amount,
        currency: session.currency,
      },
    });

    // 활성 잠금 완료 처리
    const activeLock = await this.paymentLockService.findActiveLock(id);
    if (activeLock) {
      await this.paymentLockService.completeLock(activeLock.id);
    }

    return {
      success: true,
      data: session,
      message: 'Payment captured successfully',
    };
  }

  /**
   * PaymentSession의 환불을 처리합니다.
   */
  @Post(':id/refund')
  async refundPayment(
    @Param('id') id: string,
    @Body() body: { amount?: number; reason?: string },
  ): Promise<{
    success: boolean;
    data: PaymentSession;
    message: string;
  }> {
    this.logger.log(`Processing refund for session: ${id}`);

    // 환불 가능한지 확인
    const canRefund = await this.paymentSessionService.canTransitionTo(id, 'REFUNDED');
    if (!canRefund) {
      throw new Error('Payment session cannot be refunded');
    }

    const session = await this.paymentSessionService.updateStatus(id, 'REFUNDED');

    // 환불 이벤트 기록
    await this.paymentSessionEventService.recordEvent({
      paymentSessionId: id,
      eventType: 'REFUND_COMPLETED',
      eventData: {
        refundedAt: new Date(),
        refundAmount: body.amount || session.amount,
        reason: body.reason || 'Customer requested refund',
        originalAmount: session.amount,
      },
    });

    return {
      success: true,
      data: session,
      message: 'Payment refunded successfully',
    };
  }

  /**
   * PaymentSession의 이벤트 히스토리를 조회합니다.
   */
  @Get(':id/events')
  async getPaymentSessionEvents(
    @Param('id') id: string,
  ): Promise<{
    success: boolean;
    data: {
      paymentSessionId: string;
      events: PaymentSessionEvent[];
      totalEvents: number;
    };
    message: string;
  }> {
    this.logger.log(`Retrieving events for payment session: ${id}`);

    const events = await this.paymentSessionEventService.getEventHistory(id);

    return {
      success: true,
      data: {
        paymentSessionId: id,
        events,
        totalEvents: events.length,
      },
      message: 'Payment session events retrieved successfully',
    };
  }

  /**
   * PaymentLock을 검증합니다.
   */
  @Post('validate-lock')
  @UsePipes(new ZodValidationPipe(validatePaymentLockSchema))
  async validatePaymentLock(
    @Body() dto: ValidatePaymentLockDto,
  ): Promise<{
    success: boolean;
    data: PaymentLock;
    message: string;
  }> {
    this.logger.log(`Validating payment lock: ${dto.lockToken}`);

    const lock = await this.paymentLockService.validateLock(dto);

    return {
      success: true,
      data: lock,
      message: 'Payment lock is valid',
    };
  }

  /**
   * 상태에 따른 이벤트 타입을 반환합니다.
   */



  private getEventTypeForStatus(status: PaymentSessionStatus): StatusEventType {

    return PAYMENT_SESSION_EVENT_TYPE[status] || 'SESSION_CREATED';
  }
}