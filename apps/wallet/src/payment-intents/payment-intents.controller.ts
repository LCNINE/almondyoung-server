import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentIntentsService } from './payment-intents.service';
import { RefundsService } from '../refunds/refunds.service';
import {
  ConfirmPaymentIntentDto,
  CreatePaymentIntentDto,
  PaymentIntentResponseDto,
  RefundByIntentDto,
  RefundByIntentResponseDto,
  TossApproveDto,
} from './dto';
import { RefundResponseDto } from '../refunds/dto';
import { AuthenticatedRequest } from '../wallet.module';

@ApiTags('Payment Intents')
@Controller('v1/payment-intents')
export class PaymentIntentsController {
  constructor(
    private readonly service: PaymentIntentsService,
    private readonly refundsService: RefundsService,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a payment intent (API-key authenticated, merchant backend)' })
  async create(
    @Body() dto: CreatePaymentIntentDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<PaymentIntentResponseDto> {
    // This endpoint is API-key gated; userId comes from the request body (trusted server)
    const intent = await this.service.create(dto);
    return this.toResponse(intent);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a payment intent' })
  async findOne(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<PaymentIntentResponseDto> {
    const intent = await this.service.findByIdOrThrow(id);

    // JWT path: ensure the caller owns this intent
    if (req.jwtUserId && intent.userId !== req.jwtUserId) {
      throw new ForbiddenException({ error: 'FORBIDDEN', message: 'Access denied' });
    }

    return this.toResponse(intent);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm a payment intent with a payment method' })
  async confirm(
    @Param('id') id: string,
    @Body() dto: ConfirmPaymentIntentDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<PaymentIntentResponseDto> {
    const intent = await this.service.findByIdOrThrow(id);

    // JWT path: ensure the caller owns this intent
    if (req.jwtUserId && intent.userId !== req.jwtUserId) {
      throw new ForbiddenException({ error: 'FORBIDDEN', message: 'Access denied' });
    }

    const { nextAction } = await this.service.confirm(id, dto);
    const updated = await this.service.findByIdOrThrow(id);
    return this.toResponse(updated, nextAction);
  }

  @Post(':id/toss-approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve Toss payment after checkout (API-key authenticated)' })
  async tossApprove(
    @Param('id') id: string,
    @Body() dto: TossApproveDto,
  ): Promise<PaymentIntentResponseDto> {
    await this.service.tossApprove(id, dto);
    const updated = await this.service.findByIdOrThrow(id);
    return this.toResponse(updated);
  }

  @Post(':id/capture')
  @HttpCode(200)
  @ApiOperation({ summary: 'Capture an authorized payment intent (API-key authenticated, merchant backend)' })
  async capture(
    @Param('id') id: string,
  ): Promise<PaymentIntentResponseDto> {
    await this.service.capture(id);
    const intent = await this.service.findByIdOrThrow(id);
    return this.toResponse(intent);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a payment intent' })
  async cancel(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<PaymentIntentResponseDto> {
    const intent = await this.service.findByIdOrThrow(id);

    // JWT path: ensure the caller owns this intent
    if (req.jwtUserId && intent.userId !== req.jwtUserId) {
      throw new ForbiddenException({ error: 'FORBIDDEN', message: 'Access denied' });
    }

    await this.service.cancel(id);
    const updated = await this.service.findByIdOrThrow(id);
    return this.toResponse(updated);
  }

  @Post(':id/refund')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refund a payment intent (API-key authenticated)' })
  async refund(
    @Param('id') id: string,
    @Body() dto: RefundByIntentDto,
  ): Promise<RefundByIntentResponseDto> {
    await this.service.findByIdOrThrow(id);
    const refunds = await this.refundsService.createByIntent(id, dto);
    return { intentId: id, refunds: refunds.map((r) => this.toRefundResponse(r)) };
  }

  private toRefundResponse(refund: {
    id: string;
    chargeId: string;
    intentId: string;
    status: string;
    amount: number;
    currency: string;
    reasonCode: string | null;
    reasonMessage: string | null;
    createdAt: Date;
  }): RefundResponseDto {
    return {
      id: refund.id,
      chargeId: refund.chargeId,
      intentId: refund.intentId,
      status: refund.status as any,
      amount: refund.amount,
      currency: refund.currency,
      reasonCode: refund.reasonCode,
      reasonMessage: refund.reasonMessage,
      createdAt: refund.createdAt,
    };
  }

  private toResponse(
    intent: {
      id: string;
      clientSecret: string;
      status: string;
      payableAmount: number;
      currency: string;
      userId: string;
      returnUrl: string | null;
      expiresAt: Date;
      metadata: Record<string, unknown>;
      createdAt: Date;
    },
    nextAction?: Record<string, unknown>,
  ): PaymentIntentResponseDto {
    return {
      id: intent.id,
      clientSecret: intent.clientSecret,
      status: intent.status as any,
      payableAmount: intent.payableAmount,
      currency: intent.currency,
      userId: intent.userId,
      returnUrl: intent.returnUrl,
      expiresAt: intent.expiresAt,
      metadata: intent.metadata,
      createdAt: intent.createdAt,
      ...(nextAction !== undefined ? { nextAction } : {}),
    };
  }
}
