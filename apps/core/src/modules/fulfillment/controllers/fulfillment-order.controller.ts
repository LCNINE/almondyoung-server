import { Controller, Post, Put, Delete, Body, Param, UsePipes, GoneException } from '@nestjs/common';
import { FulfillmentOrderTransactionService } from '../services/fulfillment-order-transaction.service';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';

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
  async createFulfillmentOrder() {
    throw new GoneException('POST /fulfillment-orders is deprecated. Use POST /fulfillments as the canonical path.');
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
