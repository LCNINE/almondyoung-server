import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@app/authorization';
import { ShipmentTrackingEventDto } from '../dto/shipment-tracking-event.dto';
import { ShipmentDeliveryTrackingService } from '../services/shipment-delivery-tracking.service';

@ApiTags('Shipment tracking')
@Controller('shipment-dispatch-attempts')
export class ShipmentTrackingController {
  constructor(private readonly tracking: ShipmentDeliveryTrackingService) {}

  @RequirePermission('fulfillment.tracking.ingest')
  @Post(':dispatchAttemptId/tracking-events')
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
