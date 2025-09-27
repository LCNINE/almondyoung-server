import { Controller, Get, Post, Patch, Body, Param, Query, UsePipes } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { SalesOrdersService } from '../services/sales-orders.service';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';

const CreateSalesOrderSchema = z.object({
  channelOrderId: z.string(),
  salesChannel: z.string(),
  customer: z.object({ name: z.string().optional(), email: z.string().optional(), phone: z.string().optional() }).optional(),
  shippingAddress: z.any(),
  shippingAddressHash: z.string().optional(),
  totalAmount: z.number().int().optional(),
  shippingFee: z.number().int().optional(),
  mergeGroupId: z.string().optional(),
  orderDate: z.string().datetime().optional(),
  lines: z.array(z.object({
    variantId: z.string(),
    productMatchingId: z.string().optional(),
    productName: z.string().optional(),
    quantity: z.number().int().positive(),
    unitPrice: z.number().int().optional(),
    totalPrice: z.number().int().optional(),
  })).min(1),
});

@ApiTags('Sales Orders')
@Controller('wms/sales-orders')
export class SalesOrdersController {
  constructor(private readonly service: SalesOrdersService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(CreateSalesOrderSchema))
  create(@Body() dto: any) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: any) {
    return this.service.update(id, dto);
  }

  @Post(':id/confirm')
  confirm(@Param('id') id: string) {
    return this.service.confirm(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }

  @Post('merge')
  merge(@Body() dto: any) {
    return this.service.merge(dto);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }

  @Get()
  list(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.service.list({ limit: limit ? parseInt(limit, 10) : 20, offset: offset ? parseInt(offset, 10) : 0 });
  }
}


