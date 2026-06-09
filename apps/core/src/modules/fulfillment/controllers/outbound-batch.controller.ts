import { Controller, Get, Post, Delete, Body, Param, Query, UsePipes, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { OutboundBatchService } from '../services/outbound-batch.service';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';

const CreateBatchSchema = z
  .object({
    warehouseId: z.string().uuid().optional(),
    pickingMethod: z.enum(['individual', 'total_picking']),
    name: z.string().optional(),
    scheduledPickingAt: z
      .string()
      .datetime()
      .optional()
      .transform((s) => (s ? new Date(s) : undefined)),
    salesOrderIds: z.array(z.string().uuid()).min(1).optional(),
  })
  .refine((data) => data.warehouseId || (data.salesOrderIds && data.salesOrderIds.length > 0), {
    message: 'warehouseId 또는 salesOrderIds 중 하나는 필수입니다',
    path: ['warehouseId'],
  });

const AddFulfillmentOrdersSchema = z.object({
  fulfillmentOrderIds: z.array(z.string().uuid()).min(1),
});

@ApiTags('Outbound Batches')
@Controller('outbound-batches')
export class OutboundBatchController {
  constructor(private readonly outboundBatchService: OutboundBatchService) {}

  @Post()
  @ApiOperation({ summary: '아웃바운드 배치 생성' })
  @ApiResponse({ status: 201, description: '아웃바운드 배치 생성 성공 — { batchId, linkedFoCount }' })
  @UsePipes(new ZodValidationPipe(CreateBatchSchema))
  async createBatch(@Body() dto: z.infer<typeof CreateBatchSchema>) {
    return this.outboundBatchService.createBatch(dto);
  }

  @Get()
  @ApiOperation({ summary: '아웃바운드 배치 목록 조회' })
  @ApiQuery({ name: 'warehouseId', required: false, type: String })
  async getBatches(@Query('warehouseId') warehouseId?: string) {
    return this.outboundBatchService.getBatches(warehouseId);
  }

  @Get('available/fulfillment-orders')
  @ApiOperation({ summary: '가용 주문처리 조회' })
  @ApiQuery({ name: 'warehouseId', required: true, type: String })
  async getAvailableFulfillmentOrders(@Query('warehouseId') warehouseId: string) {
    if (!warehouseId) {
      throw new BadRequestException('warehouseId is required');
    }
    return this.outboundBatchService.getAvailableFulfillmentOrders(warehouseId);
  }

  @Get(':id')
  @ApiOperation({ summary: '배치 상세 조회' })
  @ApiParam({ name: 'id', description: '배치 ID' })
  async getBatchDetail(@Param('id') batchId: string) {
    return this.outboundBatchService.getBatchDetail(batchId);
  }

  @Get(':id/picking-list')
  @ApiOperation({ summary: '피킹 목록 생성' })
  @ApiParam({ name: 'id', description: '배치 ID' })
  async getPickingList(@Param('id') batchId: string) {
    return this.outboundBatchService.generatePickingList(batchId);
  }

  @Post(':id/fulfillment-orders')
  @ApiOperation({ summary: '배치에 주문처리 추가' })
  @ApiParam({ name: 'id', description: '배치 ID' })
  // 파이프는 @Body 에만 스코프한다. 메서드 레벨 @UsePipes 는 @Param('id') 문자열까지
  // object 스키마로 파싱해 "Validation failed" 로 터뜨린다.
  async addFulfillmentOrders(
    @Param('id') batchId: string,
    @Body(new ZodValidationPipe(AddFulfillmentOrdersSchema)) dto: z.infer<typeof AddFulfillmentOrdersSchema>,
  ) {
    await this.outboundBatchService.addFulfillmentOrdersToBatch(batchId, dto.fulfillmentOrderIds);
    return { message: 'Fulfillment orders added to batch successfully' };
  }

  @Delete(':id/fulfillment-orders/:foId')
  @ApiOperation({ summary: '배치에서 주문처리 제거' })
  @ApiParam({ name: 'id', description: '배치 ID' })
  @ApiParam({ name: 'foId', description: '제거할 주문처리 ID' })
  async removeFulfillmentOrder(@Param('id') batchId: string, @Param('foId') fulfillmentOrderId: string) {
    await this.outboundBatchService.removeFulfillmentOrderFromBatch(batchId, fulfillmentOrderId);
    return { message: 'Fulfillment order removed from batch successfully' };
  }

  @Post(':id/start-picking')
  @ApiOperation({ summary: '배치 피킹 시작' })
  @ApiParam({ name: 'id', description: '배치 ID' })
  async startPicking(@Param('id') batchId: string) {
    await this.outboundBatchService.startPicking(batchId);
    return { message: 'Picking started successfully' };
  }

  @Post(':id/complete')
  @ApiOperation({ summary: '배치 완료' })
  @ApiParam({ name: 'id', description: '배치 ID' })
  async completeBatch(@Param('id') batchId: string) {
    await this.outboundBatchService.completeBatch(batchId);
    return { message: 'Batch completed successfully' };
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: '배치 취소' })
  @ApiParam({ name: 'id', description: '배치 ID' })
  async cancelBatch(@Param('id') batchId: string) {
    await this.outboundBatchService.cancelBatch(batchId);
    return { message: 'Batch canceled successfully' };
  }
}
