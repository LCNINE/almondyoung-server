import { Controller, Get, Post, Put, Delete, Body, Param, Query, UsePipes } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { OutboundBatchService } from '../../shared/services/outbound-batch.service';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';

const CreateBatchSchema = z.object({
  warehouseId: z.string().uuid(),
  pickingMethod: z.enum(['individual', 'total_picking']),
  name: z.string().optional(),
  scheduledPickingAt: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
});

const AddFulfillmentOrdersSchema = z.object({
  fulfillmentOrderIds: z.array(z.string().uuid()).min(1),
});

@ApiTags('Outbound Batches')
@Controller('outbound-batches')
export class OutboundBatchController {
  constructor(private readonly outboundBatchService: OutboundBatchService) {}

  @Post()
  @ApiOperation({
    summary: '아웃바운드 배치 생성',
    description: '효율적인 피킹을 위해 여러 주문처리를 하나의 배치로 묶어 처리합니다.',
  })
  @ApiBody({
    description: '아웃바운드 배치 생성 데이터',
    schema: {
      type: 'object',
      properties: {
        warehouseId: { type: 'string', format: 'uuid', description: '창고 ID' },
        pickingMethod: {
          type: 'string',
          enum: ['individual', 'total_picking'],
          description: '피킹 방식 (individual: 개별 피킹, total_picking: 일괄 피킹)',
        },
        name: { type: 'string', description: '배치명 (선택사항)' },
        scheduledPickingAt: { type: 'string', format: 'date-time', description: '예정 피킹 시간 (선택사항)' },
      },
      required: ['warehouseId', 'pickingMethod'],
    },
  })
  @ApiResponse({ status: 201, description: '아웃바운드 배치 생성 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  @UsePipes(new ZodValidationPipe(CreateBatchSchema))
  async createBatch(@Body() dto: z.infer<typeof CreateBatchSchema>) {
    const batchId = await this.outboundBatchService.createBatch(dto);
    return { batchId };
  }

  @Get()
  @ApiOperation({ summary: '아웃바운드 배치 목록 조회', description: '아웃바운드 배치 목록을 조회합니다.' })
  @ApiQuery({ name: 'warehouseId', required: false, type: String, description: '창고 ID 필터' })
  @ApiResponse({ status: 200, description: '배치 목록 조회 성공' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async getBatches(@Query('warehouseId') warehouseId?: string) {
    return this.outboundBatchService.getBatches(warehouseId);
  }

  @Get(':id')
  @ApiOperation({ summary: '배치 상세 조회', description: '특정 아웃바운드 배치의 상세 정보를 조회합니다.' })
  @ApiParam({ name: 'id', description: '배치 ID' })
  @ApiResponse({ status: 200, description: '배치 상세 조회 성공' })
  @ApiResponse({ status: 404, description: '배치를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async getBatchDetail(@Param('id') batchId: string) {
    return this.outboundBatchService.getBatchDetail(batchId);
  }

  @Get(':id/picking-list')
  @ApiOperation({ summary: '피킹 목록 생성', description: '배치에 대한 피킹 목록을 생성합니다.' })
  @ApiParam({ name: 'id', description: '배치 ID' })
  @ApiResponse({ status: 200, description: '피킹 목록 생성 성공' })
  @ApiResponse({ status: 404, description: '배치를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async getPickingList(@Param('id') batchId: string) {
    return this.outboundBatchService.generatePickingList(batchId);
  }

  @Post(':id/fulfillment-orders')
  @ApiOperation({ summary: '배치에 주문처리 추가', description: '아웃바운드 배치에 주문처리들을 추가합니다.' })
  @ApiParam({ name: 'id', description: '배치 ID' })
  @ApiBody({
    description: '추가할 주문처리 ID 목록',
    schema: {
      type: 'object',
      properties: {
        fulfillmentOrderIds: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
          description: '주문처리 ID 목록',
          minItems: 1,
        },
      },
      required: ['fulfillmentOrderIds'],
    },
  })
  @ApiResponse({ status: 200, description: '주문처리 배치 추가 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '배치 또는 주문처리를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  @UsePipes(new ZodValidationPipe(AddFulfillmentOrdersSchema))
  async addFulfillmentOrders(@Param('id') batchId: string, @Body() dto: z.infer<typeof AddFulfillmentOrdersSchema>) {
    await this.outboundBatchService.addFulfillmentOrdersToBatch(batchId, dto.fulfillmentOrderIds);
    return { message: 'Fulfillment orders added to batch successfully' };
  }

  @Delete(':id/fulfillment-orders/:foId')
  @ApiOperation({ summary: '배치에서 주문처리 제거', description: '아웃바운드 배치에서 특정 주문처리를 제거합니다.' })
  @ApiParam({ name: 'id', description: '배치 ID' })
  @ApiParam({ name: 'foId', description: '제거할 주문처리 ID' })
  @ApiResponse({ status: 200, description: '주문처리 배치 제거 성공' })
  @ApiResponse({ status: 404, description: '배치 또는 주문처리를 찾을 수 없음' })
  @ApiResponse({ status: 400, description: '제거할 수 없는 상태' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async removeFulfillmentOrder(@Param('id') batchId: string, @Param('foId') fulfillmentOrderId: string) {
    await this.outboundBatchService.removeFulfillmentOrderFromBatch(batchId, fulfillmentOrderId);
    return { message: 'Fulfillment order removed from batch successfully' };
  }

  @Post(':id/start-picking')
  @ApiOperation({ summary: '배치 피킹 시작', description: '아웃바운드 배치의 피킹 작업을 시작합니다.' })
  @ApiParam({ name: 'id', description: '배치 ID' })
  @ApiResponse({ status: 200, description: '배치 피킹 시작 성공' })
  @ApiResponse({ status: 404, description: '배치를 찾을 수 없음' })
  @ApiResponse({ status: 400, description: '피킹을 시작할 수 없는 상태' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async startPicking(@Param('id') batchId: string) {
    await this.outboundBatchService.startPicking(batchId);
    return { message: 'Picking started successfully' };
  }

  @Post(':id/complete')
  @ApiOperation({ summary: '배치 완료', description: '아웃바운드 배치의 모든 작업을 완료합니다.' })
  @ApiParam({ name: 'id', description: '배치 ID' })
  @ApiResponse({ status: 200, description: '배치 완료 성공' })
  @ApiResponse({ status: 404, description: '배치를 찾을 수 없음' })
  @ApiResponse({ status: 400, description: '완료할 수 없는 상태' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async completeBatch(@Param('id') batchId: string) {
    await this.outboundBatchService.completeBatch(batchId);
    return { message: 'Batch completed successfully' };
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: '배치 취소', description: '아웃바운드 배치를 취소합니다.' })
  @ApiParam({ name: 'id', description: '배치 ID' })
  @ApiResponse({ status: 200, description: '배치 취소 성공' })
  @ApiResponse({ status: 404, description: '배치를 찾을 수 없음' })
  @ApiResponse({ status: 400, description: '취소할 수 없는 상태' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async cancelBatch(@Param('id') batchId: string) {
    await this.outboundBatchService.cancelBatch(batchId);
    return { message: 'Batch canceled successfully' };
  }

  @Get('available/fulfillment-orders')
  @ApiOperation({
    summary: '가용 주문처리 조회',
    description: '배치에 추가할 수 있는 가용한 주문처리 목록을 조회합니다.',
  })
  @ApiQuery({ name: 'warehouseId', required: true, type: String, description: '창고 ID (필수)' })
  @ApiResponse({ status: 200, description: '가용 주문처리 목록 조회 성공' })
  @ApiResponse({ status: 400, description: 'warehouseId 필수' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async getAvailableFulfillmentOrders(@Query('warehouseId') warehouseId: string) {
    if (!warehouseId) {
      throw new Error('warehouseId is required');
    }
    return this.outboundBatchService.getAvailableFulfillmentOrders(warehouseId);
  }
}
