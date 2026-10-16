import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalOnly } from '@app/authorization';
import { SalesOrderLookupService } from './sales-order-lookup.service';
import { SalesOrderLookupRequestDto, SalesOrderLookupResponse } from './sales-order-lookup.dto';

/**
 * 서비스 간 호출 전용 판매주문 라우트 (#1016 45번). 호출자는 channel-adapter 의 채널 대사다.
 * 클래스 단위 `@InternalOnly()` 라 핸들러를 더해도 보호된다(`SalesChannelsInternalController` 와 같은 이유로 파일을 나눴다).
 */
@ApiExcludeController()
@InternalOnly()
@Controller('internal/sales-orders')
export class SalesOrdersInternalController {
  constructor(private readonly lookupService: SalesOrderLookupService) {}

  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  async lookup(@Body() dto: SalesOrderLookupRequestDto): Promise<SalesOrderLookupResponse> {
    return { orders: await this.lookupService.lookup(dto.salesChannel, dto.orders) };
  }
}
