import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard, User } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { ConfirmLabelPrintDto, LabelPrintConfirmationDto, WaybillLabelResponseDto } from './dto/waybill.dto';
import { WaybillLabelService } from './waybill-label.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string };

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

  // 앱이 프린터 전송에 성공한 뒤에만 부른다. 현재 내용과 다르면 409 LABEL_CONTENT_CHANGED → 앱이 다시 렌더한다.
  @Post('shipments/:shipmentId/waybill/label-prints')
  @HttpCode(HttpStatus.CREATED)
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiCreatedResponse({ type: LabelPrintConfirmationDto })
  confirmPrint(
    @Param('shipmentId') shipmentId: string,
    @Body() dto: ConfirmLabelPrintDto,
    @User() user: AuthenticatedUser,
  ) {
    const id = user?.userId ?? user?.id ?? user?.sub;
    if (!id) throw new UnauthorizedException('Authenticated actor is required');
    return this.labels.confirmPrint(shipmentId, dto.fingerprint, { id });
  }
}
