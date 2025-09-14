import { Controller, Get, Post, Body, Param, Query, UsePipes } from '@nestjs/common';
import { FulfillmentsService } from '../services/fulfillments.service';
import { ReservationsService } from '../../shared/services/reservations.service';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';

const CreateFulfillmentSchema = z.object({
  salesOrderId: z.string().optional(),
  warehouseId: z.string().optional(),
  ownerId: z.string().optional(),
  shippingAddress: z.any().optional(),
  lines: z.array(z.object({ skuId: z.string(), quantity: z.number().int().positive() })).min(1),
});

const AssignShipmentSchema = z.object({ trackingNo: z.string(), eta: z.string().datetime().optional() });
const ReserveSchema = z.object({ fulfillmentOrderLineId: z.string(), quantity: z.number().int().positive() });
const UnreserveSchema = z.object({ fulfillmentOrderLineId: z.string(), quantity: z.number().int().positive() });
const TransferSchema = z.object({ fromFulfillmentOrderLineId: z.string(), toFulfillmentOrderLineId: z.string(), quantity: z.number().int().positive() });

@Controller('wms/fulfillments')
export class FulfillmentsController {
  constructor(
    private readonly service: FulfillmentsService,
    private readonly reservations: ReservationsService,
  ) {}

  @Post()
  @UsePipes(new ZodValidationPipe(CreateFulfillmentSchema))
  create(@Body() dto: any) {
    return this.service.create(dto);
  }

  @Post(':id/split')
  split(@Param('id') id: string, @Body() dto: any) {
    return this.service.split(id, dto);
  }

  @Post(':id/assign-shipment')
  @UsePipes(new ZodValidationPipe(AssignShipmentSchema))
  assignShipment(@Param('id') id: string, @Body() dto: any) {
    return this.service.assignShipment(id, dto);
  }

  @Post(':id/ship')
  ship(@Param('id') id: string) {
    return this.service.ship(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }

  @Get()
  list(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.service.list({ limit: limit ? parseInt(limit, 10) : 20, offset: offset ? parseInt(offset, 10) : 0 });
  }

  @Post(':id/check-availability')
  checkAvailability(@Param('id') id: string) {
    return this.service.checkAvailability(id);
  }

  @Post(':id/reserve')
  @UsePipes(new ZodValidationPipe(ReserveSchema))
  reserve(@Param('id') id: string, @Body() dto: any) {
    return this.reservations.reserve(dto);
  }

  @Post(':id/unreserve')
  @UsePipes(new ZodValidationPipe(UnreserveSchema))
  unreserve(@Param('id') id: string, @Body() dto: any) {
    return this.reservations.unreserve(dto);
  }

  @Post(':id/transfer-reservation')
  @UsePipes(new ZodValidationPipe(TransferSchema))
  transfer(@Param('id') id: string, @Body() dto: any) {
    return this.reservations.transferReservation(dto);
  }
}


