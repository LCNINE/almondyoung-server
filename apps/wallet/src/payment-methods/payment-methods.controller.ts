import {
  BadRequestException,
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
import { AuthenticatedRequest } from '../wallet.module';
import { WalletJwtAuth } from '../wallet-auth.decorator';
import { tossBrandPayCustomerKey } from '../providers/toss/toss-brandpay-customer-key';
import { TossApiClient } from '../providers/toss/toss-api.client';

@ApiTags('Payment Methods')
@Controller('v1/payment-methods')
export class PaymentMethodsController {
  constructor(
    private readonly service: PaymentMethodsService,
    private readonly tossApi: TossApiClient,
  ) {}

  @Get('toss-widget-config')
  @WalletJwtAuth()
  @ApiOperation({ summary: 'Get the public Toss order-form widget configuration' })
  getTossWidgetConfig(@Req() req: AuthenticatedRequest): {
    clientKey: string;
    variantKey: string;
    customerKey: string;
    checkoutMode?: string;
    brandpayClientKey?: string;
  } | null {
    if (process.env.TOSS_CHECKOUT_MODE === 'CUSTOM') {
      if (!req.jwtUserId) throw new UnauthorizedException({ error: 'UNAUTHORIZED' });
      if (
        !process.env.TOSS_CLIENT_KEY ||
        !process.env.TOSS_SECRET_KEY ||
        !process.env.TOSS_BRANDPAY_CLIENT_KEY ||
        !process.env.TOSS_BRANDPAY_SECRET_KEY
      )
        return null;
      return {
        checkoutMode: 'CUSTOM',
        clientKey: process.env.TOSS_CLIENT_KEY,
        brandpayClientKey: process.env.TOSS_BRANDPAY_CLIENT_KEY,
        variantKey: '',
        customerKey: tossBrandPayCustomerKey(req.jwtUserId),
      };
    }
    const clientKey = process.env.TOSS_WIDGET_CLIENT_KEY;
    if (!clientKey || !process.env.TOSS_WIDGET_SECRET_KEY) return null;
    if (!req.jwtUserId) throw new UnauthorizedException({ error: 'UNAUTHORIZED' });
    return {
      clientKey,
      variantKey: process.env.TOSS_WIDGET_VARIANT_KEY ?? 'widgetA',
      customerKey: tossBrandPayCustomerKey(req.jwtUserId),
    };
  }

  @Get('toss-brandpay-cards')
  @WalletJwtAuth()
  @ApiOperation({ summary: 'Get display information for the authenticated customer’s BrandPay cards' })
  async getBrandPayCards(@Req() req: AuthenticatedRequest) {
    if (!req.jwtUserId) throw new UnauthorizedException({ error: 'UNAUTHORIZED' });
    if (!process.env.TOSS_BRANDPAY_SECRET_KEY) throw new BadRequestException({ error: 'BRANDPAY_NOT_CONFIGURED' });

    const result = await this.tossApi.getBrandPayMethods(tossBrandPayCustomerKey(req.jwtUserId));

    if (!result.ok) throw new BadRequestException({ error: result.error.code, message: result.error.message });
    return {
      cards: result.data.cards
        .filter((card) => ['신용', '체크'].includes(card.cardType))
        .map((card) => ({
          id: card.id,
          name: card.alias || card.cardName,
          number: card.cardNumber.slice(-4),
          type: card.cardType,
          color: card.color?.background ?? '#8496ab',
          cardImgUrl: card.cardImgUrl,
          iconUrl: card.iconUrl,
          installmentMinimumAmount: card.installmentMinimumAmount,
        })),
    };
  }

  @Get('toss-card-promotions')
  @WalletJwtAuth()
  @ApiOperation({ summary: 'Get current card interest-free installment promotions' })
  async getCardPromotions(@Req() req: AuthenticatedRequest) {
    if (!req.jwtUserId) throw new UnauthorizedException({ error: 'UNAUTHORIZED' });
    const clientKey = process.env.TOSS_WIDGET_CLIENT_KEY;
    if (!clientKey) throw new BadRequestException({ error: 'TOSS_WIDGET_NOT_CONFIGURED' });
    const url = new URL('https://payment-widget.tosspayments.com/free-installment');
    url.searchParams.set('client-key', clientKey);
    url.searchParams.set('variant-key', process.env.TOSS_WIDGET_VARIANT_KEY ?? 'DEFAULT');
    const promotions = await this.tossApi.getCardPromotions();
    return {
      url: url.toString(),
      interestFreeCards: promotions.ok ? promotions.data.interestFreeCards : [],
      testMode: process.env.TOSS_SECRET_KEY?.startsWith('test_') ?? false,
    };
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Register a payment method (API-key authenticated, merchant backend)' })
  async create(@Body() dto: CreatePaymentMethodDto): Promise<PaymentMethodResponseDto> {
    const method = await this.service.create(dto);
    return this.toResponse(method);
  }

  @Get()
  @WalletJwtAuth()
  @ApiOperation({ summary: 'List payment methods for the authenticated user' })
  async findAll(@Req() req: AuthenticatedRequest): Promise<PaymentMethodResponseDto[]> {
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
