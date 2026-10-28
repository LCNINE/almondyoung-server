import { Body, Controller, Get, HttpCode, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UgcInternalAuth } from '../../shared/decorators/internal-auth.decorator';
import { PurchaseSatisfactionResponseDto } from '../dto/purchase-satisfaction-response.dto';
import { UpsertPurchaseSatisfactionDto } from '../dto/upsert-purchase-satisfaction.dto';
import { PurchaseSatisfactionService } from '../purchase-satisfaction.service';

@ApiTags('Purchase Satisfaction')
@Controller('purchase-satisfactions/internal/orders')
export class InternalPurchaseSatisfactionController {
  constructor(private readonly service: PurchaseSatisfactionService) {}

  @Put(':orderId')
  @HttpCode(200)
  @UgcInternalAuth()
  @ApiOperation({ summary: '구매 만족도 저장 (Medusa 내부 호출, 주문 소유 확인은 호출 측)' })
  upsert(
    @Param('orderId') orderId: string,
    @Body() dto: UpsertPurchaseSatisfactionDto,
  ): Promise<PurchaseSatisfactionResponseDto> {
    return this.service.upsert(orderId, dto);
  }

  @Get(':orderId')
  @UgcInternalAuth()
  @ApiOperation({ summary: '구매 만족도 단건 조회 (Medusa 내부 호출)' })
  get(@Param('orderId') orderId: string): Promise<PurchaseSatisfactionResponseDto> {
    return this.service.getByOrderId(orderId);
  }
}
