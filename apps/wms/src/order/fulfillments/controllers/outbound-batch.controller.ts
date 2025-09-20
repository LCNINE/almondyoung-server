import { Controller, Get, Post, Put, Delete, Body, Param, Query, UsePipes } from '@nestjs/common';
import { OutboundBatchService } from '../../shared/services/outbound-batch.service';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';

const CreateBatchSchema = z.object({
  warehouseId: z.string().uuid(),
  pickingMethod: z.enum(['individual', 'total_picking']),
  name: z.string().optional(),
  scheduledPickingAt: z.string().datetime().optional().transform(s => s ? new Date(s) : undefined)
});

const AddFulfillmentOrdersSchema = z.object({
  fulfillmentOrderIds: z.array(z.string().uuid()).min(1)
});

@Controller('wms/outbound-batches')
export class OutboundBatchController {
  constructor(
    private readonly outboundBatchService: OutboundBatchService
  ) {}

  @Post()
  @UsePipes(new ZodValidationPipe(CreateBatchSchema))
  async createBatch(@Body() dto: z.infer<typeof CreateBatchSchema>) {
    const batchId = await this.outboundBatchService.createBatch(dto);
    return { batchId };
  }

  @Get()
  async getBatches(@Query('warehouseId') warehouseId?: string) {
    return this.outboundBatchService.getBatches(warehouseId);
  }

  @Get(':id')
  async getBatchDetail(@Param('id') batchId: string) {
    return this.outboundBatchService.getBatchDetail(batchId);
  }

  @Get(':id/picking-list')
  async getPickingList(@Param('id') batchId: string) {
    return this.outboundBatchService.generatePickingList(batchId);
  }

  @Post(':id/fulfillment-orders')
  @UsePipes(new ZodValidationPipe(AddFulfillmentOrdersSchema))
  async addFulfillmentOrders(
    @Param('id') batchId: string,
    @Body() dto: z.infer<typeof AddFulfillmentOrdersSchema>
  ) {
    await this.outboundBatchService.addFulfillmentOrdersToBatch(batchId, dto.fulfillmentOrderIds);
    return { message: 'Fulfillment orders added to batch successfully' };
  }

  @Delete(':id/fulfillment-orders/:foId')
  async removeFulfillmentOrder(
    @Param('id') batchId: string,
    @Param('foId') fulfillmentOrderId: string
  ) {
    await this.outboundBatchService.removeFulfillmentOrderFromBatch(batchId, fulfillmentOrderId);
    return { message: 'Fulfillment order removed from batch successfully' };
  }

  @Post(':id/start-picking')
  async startPicking(@Param('id') batchId: string) {
    await this.outboundBatchService.startPicking(batchId);
    return { message: 'Picking started successfully' };
  }

  @Post(':id/complete')
  async completeBatch(@Param('id') batchId: string) {
    await this.outboundBatchService.completeBatch(batchId);
    return { message: 'Batch completed successfully' };
  }

  @Post(':id/cancel')
  async cancelBatch(@Param('id') batchId: string) {
    await this.outboundBatchService.cancelBatch(batchId);
    return { message: 'Batch canceled successfully' };
  }

  @Get('available/fulfillment-orders')
  async getAvailableFulfillmentOrders(@Query('warehouseId') warehouseId: string) {
    if (!warehouseId) {
      throw new Error('warehouseId is required');
    }
    return this.outboundBatchService.getAvailableFulfillmentOrders(warehouseId);
  }
}