import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletJwtAuth } from '../wallet-auth.decorator';
import { AuthenticatedRequest } from '../wallet.module';
import { CheckoutSessionService } from './checkout-session.service';
import {
  CheckoutSessionResponseDto,
  CompleteCheckoutSessionDto,
  CreateCheckoutSessionDto,
} from './dto';
import { CheckoutSession } from '../types';

@ApiTags('Checkout Sessions')
@Controller('v1/checkout-sessions')
export class CheckoutSessionController {
  constructor(private readonly service: CheckoutSessionService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a checkout session (API-key authenticated, external service)' })
  async create(@Body() dto: CreateCheckoutSessionDto): Promise<CheckoutSessionResponseDto> {
    try {
      const session = await this.service.create({
        userId: dto.userId,
        amount: dto.amount,
        currency: dto.currency,
        purpose: dto.purpose,
        metadata: dto.metadata,
        successUrl: dto.successUrl,
        cancelUrl: dto.cancelUrl,
        allowComposite: dto.allowComposite,
      });
      return this.toResponse(session);
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.match(/already|invalid|failed/)) throw new BadRequestException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Get(':id')
  @WalletJwtAuth()
  @ApiOperation({ summary: 'Get a checkout session (wallet-web loads this)' })
  async get(@Param('id') id: string): Promise<CheckoutSessionResponseDto> {
    const session = await this.service.get(id);
    if (!session) {
      throw new NotFoundException('checkout session not found');
    }
    return this.toResponse(session);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @WalletJwtAuth()
  @ApiOperation({ summary: 'Complete a checkout session after payment' })
  async complete(
    @Param('id') id: string,
    @Body() dto: CompleteCheckoutSessionDto,
  ): Promise<void> {
    try {
      await this.service.complete(id, dto.intentId, dto.billingMethodId);
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      if (msg.match(/already|invalid|expired/)) throw new BadRequestException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  private toResponse(s: CheckoutSession): CheckoutSessionResponseDto {
    return {
      id: s.id,
      userId: s.userId,
      amount: s.amount,
      currency: s.currency,
      purpose: s.purpose,
      metadata: s.metadata as Record<string, unknown>,
      successUrl: s.successUrl,
      cancelUrl: s.cancelUrl,
      allowComposite: s.allowComposite,
      intentId: s.intentId,
      status: s.status,
      expiresAt: s.expiresAt,
      createdAt: s.createdAt,
    };
  }
}
