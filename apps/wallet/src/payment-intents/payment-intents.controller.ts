import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
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
import { WalletJwtAuth } from '../wallet-auth.decorator';

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
  @WalletJwtAuth()
  @ApiOperation({ summary: 'Get a payment intent' })
  async findOne(@Param('id') id: string): Promise<PaymentIntentResponseDto> {
    const intent = await this.service.findByIdOrThrow(id);
    return this.toResponse(intent);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @WalletJwtAuth()
  @ApiOperation({ summary: 'Confirm a payment intent with a payment method' })
  async confirm(
    @Param('id') id: string,
    @Body() dto: ConfirmPaymentIntentDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<PaymentIntentResponseDto> {
    if (req.jwtUserId) {
      await this.claimOrVerify(id, req.jwtUserId);
    }

    const { nextAction } = await this.service.confirm(id, dto);
    const updated = await this.service.findByIdOrThrow(id);
    return this.toResponse(updated, nextAction);
  }

  @Post(':id/toss-approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve Toss payment after checkout (API-key authenticated)' })
  async tossApprove(@Param('id') id: string, @Body() dto: TossApproveDto): Promise<PaymentIntentResponseDto> {
    await this.service.tossApprove(id, dto);
    const updated = await this.service.findByIdOrThrow(id);
    return this.toResponse(updated);
  }

  @Post(':id/capture')
  @HttpCode(200)
  @ApiOperation({ summary: 'Capture an authorized payment intent (API-key authenticated, merchant backend)' })
  async capture(@Param('id') id: string): Promise<PaymentIntentResponseDto> {
    await this.service.capture(id);
    const intent = await this.service.findByIdOrThrow(id);
    return this.toResponse(intent);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @WalletJwtAuth()
  @ApiOperation({ summary: 'Cancel a payment intent' })
  async cancel(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<PaymentIntentResponseDto> {
    if (req.jwtUserId) {
      await this.claimOrVerify(id, req.jwtUserId);
    }

    await this.service.cancel(id);
    const updated = await this.service.findByIdOrThrow(id);
    return this.toResponse(updated);
  }

  @Post(':id/refund')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refund a payment intent (API-key authenticated)' })
  async refund(@Param('id') id: string, @Body() dto: RefundByIntentDto): Promise<RefundByIntentResponseDto> {
    await this.service.findByIdOrThrow(id);
    const refunds = await this.refundsService.createByIntent(id, dto);
    return { intentId: id, refunds: refunds.map((r) => this.toRefundResponse(r)) };
  }

  // userId가 null이면 atomic claim, 이미 설정됐으면 소유권 검증
  private async claimOrVerify(intentId: string, jwtUserId: string): Promise<void> {
    const intent = await this.service.findByIdOrThrow(intentId);
    if (intent.userId === null) {
      const claimed = await this.service.claimIntent(intentId, jwtUserId);
      // 동시 요청이 먼저 claim한 경우 재조회 후 소유권 체크
      if (!claimed) {
        const latest = await this.service.findByIdOrThrow(intentId);
        if (latest.userId !== jwtUserId) {
          throw new ForbiddenException({ error: 'FORBIDDEN', message: 'Access denied' });
        }
      }
    } else if (intent.userId !== jwtUserId) {
      throw new ForbiddenException({ error: 'FORBIDDEN', message: 'Access denied' });
    }
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
      manualConfirmable: false,
    };
  }

  private toResponse(
    intent: {
      id: string;
      clientSecret: string;
      status: string;
      payableAmount: number;
      currency: string;
      userId: string | null;
      returnUrl: string | null;
      expiresAt: Date;
      metadata: Record<string, unknown>;
      createdAt: Date;
      items?: {
        id: string;
        lineId: string;
        name: string;
        itemType: string | null;
        unitPrice: number;
        quantity: number;
        baseAmount: number;
        itemDiscountPerUnitTotal: number;
        itemDiscountFlatTotal: number;
        payableAmount: number;
        discounts: {
          id: string;
          kind: string;
          amount: number;
          name: string | null;
          discountRefId: string | null;
        }[];
      }[];
      orderDiscounts?: {
        id: string;
        kind: string;
        amount: number;
        name: string | null;
        discountRefId: string | null;
      }[];
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
      ...(intent.items && intent.items.length > 0
        ? {
            items: intent.items.map((item) => ({
              id: item.id,
              lineId: item.lineId,
              name: item.name,
              itemType: item.itemType,
              unitPrice: item.unitPrice,
              quantity: item.quantity,
              baseAmount: item.baseAmount,
              itemDiscountPerUnitTotal: item.itemDiscountPerUnitTotal,
              itemDiscountFlatTotal: item.itemDiscountFlatTotal,
              payableAmount: item.payableAmount,
              discounts: item.discounts.map((d) => ({
                id: d.id,
                kind: d.kind,
                amount: d.amount,
                name: d.name,
                discountRefId: d.discountRefId,
              })),
            })),
          }
        : {}),
      ...(intent.orderDiscounts && intent.orderDiscounts.length > 0
        ? {
            orderDiscounts: intent.orderDiscounts.map((d) => ({
              id: d.id,
              kind: d.kind,
              amount: d.amount,
              name: d.name,
              discountRefId: d.discountRefId,
            })),
          }
        : {}),
      ...(nextAction !== undefined ? { nextAction } : {}),
    };
  }
}
