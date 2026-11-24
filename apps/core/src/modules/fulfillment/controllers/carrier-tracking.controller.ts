import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission, User } from '@app/authorization';
import { CarrierTrackingService } from '../carrier-tracking/carrier-tracking.service';
import {
  CarrierTrackingAttentionDto,
  CarrierTrackingConfirmResultDto,
  CarrierTrackingShipmentDto,
  CarrierTrackingSummaryDto,
  ConfirmCarrierTrackingDto,
} from '../carrier-tracking/dto/carrier-tracking.dto';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string } | undefined;

/** 우리는 출고했는데 택배사는 어떻게 알고 있는지 맞춰 본다 */
@ApiTags('Carrier tracking')
@Controller('carrier-tracking')
export class CarrierTrackingController {
  constructor(private readonly service: CarrierTrackingService) {}

  @RequirePermission('fulfillment.order.read')
  @Get('attention/summary')
  @ApiOperation({ summary: '택배사 확인이 필요한 송장 수' })
  @ApiOkResponse({ type: CarrierTrackingSummaryDto })
  summary(): Promise<CarrierTrackingSummaryDto> {
    return this.service.summary();
  }

  @RequirePermission('fulfillment.order.read')
  @Get('attention')
  @ApiOperation({ summary: '택배사 확인이 필요한 송장 목록' })
  @ApiOkResponse({ type: CarrierTrackingAttentionDto })
  attention(): Promise<CarrierTrackingAttentionDto> {
    return this.service.attention();
  }

  @RequirePermission('fulfillment.order.read')
  @Get('shipments/:shipmentId')
  @ApiOperation({ summary: '상자 하나의 출고별 택배사 상태' })
  @ApiOkResponse({ type: CarrierTrackingShipmentDto })
  forShipment(@Param('shipmentId', new ParseUUIDPipe()) shipmentId: string): Promise<CarrierTrackingShipmentDto> {
    return this.service.forShipment(shipmentId);
  }

  @RequirePermission('fulfillment.warehouse.operate')
  @Post('attempts/:dispatchAttemptId/checks')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '택배사에 지금 다시 조회' })
  @ApiOkResponse({ type: CarrierTrackingShipmentDto })
  recheck(
    @Param('dispatchAttemptId', new ParseUUIDPipe()) dispatchAttemptId: string,
  ): Promise<CarrierTrackingShipmentDto> {
    return this.service.recheck(dispatchAttemptId);
  }

  @RequirePermission('fulfillment.warehouse.operate')
  @Post('attempts/:dispatchAttemptId/confirmations')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: '택배사에 확인한 내용 기록' })
  @ApiOkResponse({ type: CarrierTrackingConfirmResultDto })
  confirm(
    @Param('dispatchAttemptId', new ParseUUIDPipe()) dispatchAttemptId: string,
    @Body() dto: ConfirmCarrierTrackingDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user?: AuthenticatedUser,
  ): Promise<CarrierTrackingConfirmResultDto> {
    const actorId = user?.userId ?? user?.id ?? user?.sub;
    if (!actorId) throw new UnauthorizedException('Authenticated actor is required');
    return this.service.confirm(dispatchAttemptId, dto, idempotencyKey ?? '', actorId);
  }
}
