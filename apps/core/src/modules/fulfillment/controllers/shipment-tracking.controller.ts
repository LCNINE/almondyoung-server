import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { ShipmentTrackingEventDto } from '../dto/shipment-tracking-event.dto';
import { ShipmentDeliveryTrackingService } from '../services/shipment-delivery-tracking.service';

@ApiTags('Shipment tracking')
@Controller('shipment-dispatch-attempts')
export class ShipmentTrackingController {
  constructor(private readonly tracking: ShipmentDeliveryTrackingService) {}

  @Post(':dispatchAttemptId/tracking-events')
  @UseGuards(ScopeGuard)
  @RequireScopes(FULFILLMENT_SCOPE.TRACKING_INGEST)
  @ApiOperation({ summary: 'Record an idempotent normalized carrier tracking event' })
  @ApiParam({ name: 'dispatchAttemptId', description: 'Dispatch attempt ID' })
  @ApiCreatedResponse({ description: 'Attempt-owned tracking projection' })
  record(
    @Param('dispatchAttemptId', new ParseUUIDPipe()) dispatchAttemptId: string,
    @Body() dto: ShipmentTrackingEventDto,
  ) {
    return this.tracking.recordProviderEvent(dispatchAttemptId, dto);
  }
}
