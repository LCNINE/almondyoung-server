import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { WaybillLabelResponseDto } from './dto/waybill.dto';
import { WaybillLabelService } from './waybill-label.service';

@Controller()
@UseGuards(ScopeGuard)
export class WaybillLabelController {
  constructor(private readonly labels: WaybillLabelService) {}

  // 한진 자체출력 운송장(ZPL). 부작용 없음 — 재출력은 같은 호출을 한 번 더(#913).
  @Get('shipments/:shipmentId/waybill/label')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOkResponse({ type: WaybillLabelResponseDto })
  label(@Param('shipmentId') shipmentId: string) {
    return this.labels.renderLabel(shipmentId);
  }
}
