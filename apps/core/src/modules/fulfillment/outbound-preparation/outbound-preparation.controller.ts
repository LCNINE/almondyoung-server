import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '@app/authorization';
import { OutboundPreparationQueryDto, OutboundPreparationSummaryDto } from '../dto/outbound-preparation.dto';
import { OutboundPreparationService } from './outbound-preparation.service';

@Controller()
export class OutboundPreparationController {
  constructor(private readonly service: OutboundPreparationService) {}

  @RequirePermission('fulfillment.shipment.read')
  @Get('outbound-preparation')
  summarize(@Query() query: OutboundPreparationQueryDto): Promise<OutboundPreparationSummaryDto> {
    return this.service.summarize(query.warehouseId);
  }
}
