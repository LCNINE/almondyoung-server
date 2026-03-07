import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentMethodsService } from './payment-methods.service';
import { CreatePaymentMethodDto, PaymentMethodResponseDto } from './dto';
import { AuthenticatedRequest, WalletJwtAuth } from '../wallet.module';

@ApiTags('Payment Methods')
@Controller('v1/payment-methods')
export class PaymentMethodsController {
  constructor(private readonly service: PaymentMethodsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Register a payment method (API-key authenticated, merchant backend)' })
  async create(
    @Body() dto: CreatePaymentMethodDto,
  ): Promise<PaymentMethodResponseDto> {
    const method = await this.service.create(dto);
    return this.toResponse(method);
  }

  @Get()
  @WalletJwtAuth()
  @ApiOperation({ summary: 'List payment methods for the authenticated user' })
  async findAll(
    @Req() req: AuthenticatedRequest,
  ): Promise<PaymentMethodResponseDto[]> {
    // JWT path: userId comes from JWT claim
    // API-key path: userId comes from query param (merchant-side lookup)
    const userId = req.jwtUserId ?? this.getUserIdFromQuery(req);
    if (!userId) {
      throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'Unable to determine user identity' });
    }
    const methods = await this.service.findAllByUserId(userId);
    return methods.map((m) => this.toResponse(m));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a payment method' })
  async delete(@Param('id') id: string): Promise<void> {
    await this.service.delete(id);
  }

  private getUserIdFromQuery(req: AuthenticatedRequest): string | null {
    const url = req.url ?? '';
    const qs = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
    const params = new URLSearchParams(qs);
    return params.get('user_id') ?? null;
  }

  private toResponse(method: {
    id: string;
    userId: string;
    type: string;
    displayName: string | null;
    isReusable: boolean;
    createdAt: Date;
  }): PaymentMethodResponseDto {
    return {
      id: method.id,
      userId: method.userId,
      type: method.type as any,
      displayName: method.displayName ?? null,
      isReusable: method.isReusable,
      createdAt: method.createdAt,
    };
  }
}
