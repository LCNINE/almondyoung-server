import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalOnly } from '@app/authorization';
import { ReturnEligibilityService } from './return-eligibility.service';
import { ReturnEligibilityRequestDto } from './return-eligibility.dto';
import type { ReturnEligibilityResponse } from './return-eligibility';
import { SalesOrderLookupService } from './sales-order-lookup.service';
import { SalesOrderLookupRequestDto, SalesOrderLookupResponse } from './sales-order-lookup.dto';
import { CustomerReturnService } from '../customer-return/customer-return.service';
import { ReleaseCustomerReturnPickupDto } from './dto/release-customer-return-pickup.dto';

/**
 * 서비스 간 호출 전용 판매주문 라우트 (#1016 45번). 호출자는 channel-adapter 의 채널 대사다.
 * 클래스 단위 `@InternalOnly()` 라 핸들러를 더해도 보호된다(`SalesChannelsInternalController` 와 같은 이유로 파일을 나눴다).
 */
@ApiExcludeController()
@InternalOnly()
@Controller('internal/sales-orders')
export class SalesOrdersInternalController {
  constructor(
    private readonly lookupService: SalesOrderLookupService,
    private readonly returnEligibilityService: ReturnEligibilityService,
    private readonly customerReturnService: CustomerReturnService,
  ) {}

  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  async lookup(@Body() dto: SalesOrderLookupRequestDto): Promise<SalesOrderLookupResponse> {
    return { orders: await this.lookupService.lookup(dto.salesChannel, dto.orders) };
  }

  /** K8 PR3 — Medusa 반품 요청이 줄마다 배송완료 판매 단위·마지막 배송완료 시각을 묻는다. 반품 차감은 싣지 않는다. */
  @Post('return-eligibility')
  @HttpCode(HttpStatus.OK)
  returnEligibility(@Body() dto: ReturnEligibilityRequestDto): Promise<ReturnEligibilityResponse> {
    return this.returnEligibilityService.read(dto);
  }

  /**
   * K8 PR9 N6 — Medusa 가 반품을 취소하기 전에 한진 회수 예약을 먼저 놓는다. released 면 취소해도 되고 picked_up 이면
   * 기사가 이미 집하해 취소를 거절한다. exchange_released 면 교환 대체 상자가 이미 열려 취소를 거절한다(K8 PR11).
   * 409(보내는 중)·502(한진 취소 실패)는 Medusa 가 «판정 불가»로 읽는다.
   */
  @Post('customer-return-pickup/release')
  @HttpCode(HttpStatus.OK)
  releaseCustomerReturnPickup(
    @Body() dto: ReleaseCustomerReturnPickupDto,
  ): Promise<{ result: 'released' | 'picked_up' | 'exchange_released' }> {
    return this.customerReturnService.releasePickup(dto.channelReturnId);
  }
}
