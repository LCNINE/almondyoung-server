import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentConfigService } from './payment-config.service';
import { WalletJwtAuth } from '../wallet-auth.decorator';
import { AvailablePaymentMethodDto } from './dto';

/**
 * storefront/wallet-web facing.
 * 리전(소문자 alpha-2)에서 실제 노출 가능한 결제수단 종류를 반환한다.
 */
@ApiTags('Payment Config')
@Controller('v1/regions')
export class PaymentConfigController {
  constructor(private readonly service: PaymentConfigService) {}

  @Get(':code/payment-methods')
  @WalletJwtAuth()
  @ApiOperation({ summary: '해당 리전에서 사용 가능한 결제수단 목록' })
  async available(@Param('code') code: string): Promise<AvailablePaymentMethodDto[]> {
    return this.service.getAvailablePaymentMethods(code);
  }
}
