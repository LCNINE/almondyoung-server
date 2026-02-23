import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentIntentsService } from './payment-intents.service';
import {
  ConfirmPaymentIntentDto,
  CreatePaymentIntentDto,
  PaymentIntentResponseDto,
} from './dto';

@ApiTags('Payment Intents')
@Controller('v1/payment-intents')
export class PaymentIntentsController {
  constructor(private readonly service: PaymentIntentsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a payment intent' })
  async create(@Body() dto: CreatePaymentIntentDto): Promise<PaymentIntentResponseDto> {
    const intent = await this.service.create(dto);
    // create() returns the intent row; we need externalUserId from the customer join
    const full = await this.service.findByIdWithCustomerOrThrow(intent.id);
    return this.toResponse(full);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a payment intent' })
  async findOne(@Param('id') id: string): Promise<PaymentIntentResponseDto> {
    const intent = await this.service.findByIdWithCustomerOrThrow(id);
    return this.toResponse(intent);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm a payment intent with a payment method' })
  async confirm(
    @Param('id') id: string,
    @Body() dto: ConfirmPaymentIntentDto,
  ): Promise<PaymentIntentResponseDto> {
    await this.service.confirm(id, dto);
    const intent = await this.service.findByIdWithCustomerOrThrow(id);
    return this.toResponse(intent);
  }

  @Post(':id/capture')
  @HttpCode(200)
  @ApiOperation({ summary: 'Capture an authorized payment intent' })
  async capture(@Param('id') id: string): Promise<PaymentIntentResponseDto> {
    await this.service.capture(id);
    const intent = await this.service.findByIdWithCustomerOrThrow(id);
    return this.toResponse(intent);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a payment intent' })
  async cancel(@Param('id') id: string): Promise<PaymentIntentResponseDto> {
    await this.service.cancel(id);
    const intent = await this.service.findByIdWithCustomerOrThrow(id);
    return this.toResponse(intent);
  }

  private toResponse(
    intent: {
      id: string;
      clientSecret: string;
      status: string;
      payableAmount: number;
      currency: string;
      externalUserId: string;
      returnUrl: string | null;
      expiresAt: Date;
      metadata: Record<string, unknown>;
      createdAt: Date;
    },
  ): PaymentIntentResponseDto {
    return {
      id: intent.id,
      clientSecret: intent.clientSecret,
      status: intent.status as any,
      payableAmount: intent.payableAmount,
      currency: intent.currency,
      externalUserId: intent.externalUserId,
      returnUrl: intent.returnUrl,
      expiresAt: intent.expiresAt,
      metadata: intent.metadata,
      createdAt: intent.createdAt,
    };
  }
}
