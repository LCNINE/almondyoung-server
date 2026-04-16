import { Controller, Get, Post, Put, Delete, Body, Param, UsePipes } from '@nestjs/common';
import { FulfillmentOrderTransactionService } from '../services/fulfillment-order-transaction.service';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';

const CreateFulfillmentOrderSchema = z.object({
  warehouseId: z.string().uuid(),
  fulfillmentMode: z.enum(['in_house', '3pl', 'drop_ship']),
  priority: z.enum(['normal', 'high', 'urgent']).default('normal'),
  items: z
    .array(
      z.object({
        salesOrderId: z.string(),
        salesOrderLineId: z.string(),
        productId: z.string(),
        variantId: z.string(),
        qty: z.number().int().positive(),
      }),
    )
    .min(1),
});

const UpdatePrioritySchema = z.object({
  priority: z.enum(['normal', 'high', 'urgent']),
});

const AllocateToBatchSchema = z.object({
  batchId: z.string().uuid(),
});

@Controller('fulfillment-orders')
export class FulfillmentOrderController {
  constructor(private readonly fulfillmentOrderTransactionService: FulfillmentOrderTransactionService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(CreateFulfillmentOrderSchema))
  async createFulfillmentOrder(@Body() dto: z.infer<typeof CreateFulfillmentOrderSchema>) {
    return this.fulfillmentOrderTransactionService.createFulfillmentOrder(dto);
  }

  @Delete(':id')
  async cancelFulfillmentOrder(@Param('id') fulfillmentOrderId: string) {
    await this.fulfillmentOrderTransactionService.cancelFulfillmentOrder(fulfillmentOrderId);
    return { message: 'Fulfillment order canceled successfully' };
  }

  @Put(':id/priority')
  @UsePipes(new ZodValidationPipe(UpdatePrioritySchema))
  async updatePriority(@Param('id') fulfillmentOrderId: string, @Body() dto: z.infer<typeof UpdatePrioritySchema>) {
    await this.fulfillmentOrderTransactionService.updateFulfillmentOrderPriority(fulfillmentOrderId, dto.priority);
    return { message: 'Priority updated successfully' };
  }

  @Post(':id/allocate')
  @UsePipes(new ZodValidationPipe(AllocateToBatchSchema))
  async allocateToOutboundBatch(
    @Param('id') fulfillmentOrderId: string,
    @Body() dto: z.infer<typeof AllocateToBatchSchema>,
  ) {
    await this.fulfillmentOrderTransactionService.allocateToOutboundBatch(fulfillmentOrderId, dto.batchId);
    return { message: 'Allocated to outbound batch successfully' };
  }
}
