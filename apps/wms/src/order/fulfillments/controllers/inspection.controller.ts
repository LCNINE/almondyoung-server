import { Controller, Get, Post, Put, Body, Param, Query, UsePipes } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { InspectionService } from '../../shared/services/inspection.service';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';

const StartInspectionSchema = z.object({
  fulfillmentOrderId: z.string().uuid(),
  type: z.enum(['individual', 'batch']),
  inspectorUserId: z.string()
});

const InspectItemSchema = z.object({
  sessionId: z.string(),
  foiId: z.string().uuid(),
  inspectedQty: z.number().int().min(0),
  approvedQty: z.number().int().min(0),
  rejectedQty: z.number().int().min(0).default(0),
  issues: z.array(z.object({
    type: z.enum(['quantity_mismatch', 'quality_issue', 'damage', 'wrong_item', 'other']),
    severity: z.enum(['minor', 'major', 'critical']),
    description: z.string(),
    qty: z.number().int().min(0).optional(),
    photos: z.array(z.string()).optional()
  })).default([]),
  inspectorUserId: z.string()
});

const ForceShipmentSchema = z.object({
  foiId: z.string().uuid(),
  reason: z.string().min(1),
  authorizedBy: z.string().min(1),
  forceQty: z.number().int().positive(),
  note: z.string().optional()
});

const BulkApproveSchema = z.object({
  foiIds: z.array(z.string().uuid()).min(1),
  inspectorUserId: z.string()
});

const CompleteSessionSchema = z.object({
  sessionId: z.string(),
  inspectorUserId: z.string()
});

@ApiTags('Inspection')
@Controller('wms/inspection')
export class InspectionController {
  constructor(
    private readonly inspectionService: InspectionService
  ) {}

  @Post('sessions')
  @ApiOperation({ summary: '품질검사 세션 시작', description: '주문처리에 대한 품질검사 세션을 시작합니다.' })
  @ApiBody({
    description: '품질검사 세션 시작 데이터',
    schema: {
      type: 'object',
      properties: {
        fulfillmentOrderId: { type: 'string', format: 'uuid', description: '주문처리 ID' },
        type: { type: 'string', enum: ['individual', 'batch'], description: '검사 타입' },
        inspectorUserId: { type: 'string', description: '검사자 사용자 ID' }
      },
      required: ['fulfillmentOrderId', 'type', 'inspectorUserId']
    }
  })
  @ApiResponse({ status: 201, description: '품질검사 세션 시작 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  @UsePipes(new ZodValidationPipe(StartInspectionSchema))
  async startInspectionSession(@Body() dto: z.infer<typeof StartInspectionSchema>) {
    return this.inspectionService.startInspectionSession(dto);
  }

  @Post('sessions/:sessionId/complete')
  @ApiOperation({ summary: '품질검사 세션 완료', description: '진행 중인 품질검사 세션을 완료합니다.' })
  @ApiParam({ name: 'sessionId', description: '품질검사 세션 ID' })
  @ApiBody({
    description: '품질검사 세션 완료 데이터',
    schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '세션 ID' },
        inspectorUserId: { type: 'string', description: '검사자 사용자 ID' }
      },
      required: ['sessionId', 'inspectorUserId']
    }
  })
  @ApiResponse({ status: 200, description: '품질검사 세션 완료 성공' })
  @ApiResponse({ status: 404, description: '품질검사 세션을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  @UsePipes(new ZodValidationPipe(CompleteSessionSchema))
  async completeInspectionSession(
    @Param('sessionId') sessionId: string,
    @Body() dto: z.infer<typeof CompleteSessionSchema>
  ) {
    await this.inspectionService.completeInspectionSession(sessionId, dto.inspectorUserId);
    return { message: 'Inspection session completed successfully' };
  }

  @Post('items/inspect')
  @ApiOperation({ summary: '상품 품질검사', description: '개별 상품에 대한 품질검사를 수행합니다.' })
  @ApiBody({
    description: '상품 품질검사 데이터',
    schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '검사 세션 ID' },
        foiId: { type: 'string', format: 'uuid', description: '주문처리 아이템 ID' },
        inspectedQty: { type: 'number', minimum: 0, description: '검사 수량' },
        approvedQty: { type: 'number', minimum: 0, description: '승인 수량' },
        rejectedQty: { type: 'number', minimum: 0, description: '거부 수량' },
        issues: {
          type: 'array',
          description: '품질 이슈 목록',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['quantity_mismatch', 'quality_issue', 'damage', 'wrong_item', 'other'] },
              severity: { type: 'string', enum: ['minor', 'major', 'critical'] },
              description: { type: 'string' },
              qty: { type: 'number', minimum: 0 },
              photos: { type: 'array', items: { type: 'string' } }
            }
          }
        },
        inspectorUserId: { type: 'string', description: '검사자 사용자 ID' }
      },
      required: ['sessionId', 'foiId', 'inspectedQty', 'approvedQty', 'inspectorUserId']
    }
  })
  @ApiResponse({ status: 200, description: '상품 품질검사 완료' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '주문처리 아이템을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  @UsePipes(new ZodValidationPipe(InspectItemSchema))
  async inspectItem(@Body() dto: z.infer<typeof InspectItemSchema>) {
    return this.inspectionService.inspectItem(dto);
  }

  @Post('items/force-shipment')
  @ApiOperation({ summary: '강제 배송 승인', description: '품질검사 실패 상품에 대한 강제 배솤을 승인합니다.' })
  @ApiBody({
    description: '강제 배송 승인 데이터',
    schema: {
      type: 'object',
      properties: {
        foiId: { type: 'string', format: 'uuid', description: '주문처리 아이템 ID' },
        reason: { type: 'string', minLength: 1, description: '강제 배송 사유' },
        authorizedBy: { type: 'string', minLength: 1, description: '승인자' },
        forceQty: { type: 'number', minimum: 1, description: '강제 배송 수량' },
        note: { type: 'string', description: '추가 메모' }
      },
      required: ['foiId', 'reason', 'authorizedBy', 'forceQty']
    }
  })
  @ApiResponse({ status: 200, description: '강제 배송 승인 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '주문처리 아이템을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  @UsePipes(new ZodValidationPipe(ForceShipmentSchema))
  async forceShipment(@Body() dto: z.infer<typeof ForceShipmentSchema>) {
    await this.inspectionService.forceShipment(dto);
    return { message: 'Forced shipment authorized successfully' };
  }

  @Put('items/:foiId/reset')
  @ApiOperation({ summary: '품질검사 재설정', description: '상품의 품질검사 상태를 재설정합니다.' })
  @ApiParam({ name: 'foiId', description: '주문처리 아이템 ID' })
  @ApiQuery({ name: 'inspectorUserId', description: '검사자 사용자 ID', required: true })
  @ApiResponse({ status: 200, description: '품질검사 재설정 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '주문처리 아이템을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async resetInspection(
    @Param('foiId') foiId: string,
    @Query('inspectorUserId') inspectorUserId: string
  ) {
    if (!inspectorUserId) {
      throw new Error('inspectorUserId is required');
    }
    await this.inspectionService.resetInspection(foiId, inspectorUserId);
    return { message: 'Inspection reset successfully' };
  }

  @Post('items/bulk-approve')
  @ApiOperation({ summary: '상품 일괄 승인', description: '여러 상품을 동시에 품질검사 승인 처리합니다.' })
  @ApiBody({
    description: '일괄 승인 데이터',
    schema: {
      type: 'object',
      properties: {
        foiIds: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
          minItems: 1,
          description: '승인할 주문처리 아이템 ID 목록'
        },
        inspectorUserId: { type: 'string', description: '검사자 사용자 ID' }
      },
      required: ['foiIds', 'inspectorUserId']
    }
  })
  @ApiResponse({ status: 200, description: '일괄 승인 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  @UsePipes(new ZodValidationPipe(BulkApproveSchema))
  async bulkApprove(@Body() dto: z.infer<typeof BulkApproveSchema>) {
    const approvedCount = await this.inspectionService.bulkApprove(dto.foiIds, dto.inspectorUserId);
    return {
      message: `Successfully approved ${approvedCount} items`,
      approvedCount
    };
  }

  @Get('fulfillment-orders/:foId/summary')
  @ApiOperation({ summary: '주문처리 품질검사 요약', description: '주문처리에 대한 품질검사 요약 정보를 조회합니다.' })
  @ApiParam({ name: 'foId', description: '주문처리 ID' })
  @ApiResponse({ status: 200, description: '품질검사 요약 조회 성공' })
  @ApiResponse({ status: 404, description: '주문처리를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async getInspectionSummary(@Param('foId') fulfillmentOrderId: string) {
    return this.inspectionService.getInspectionSummary(fulfillmentOrderId);
  }

  @Get('items/:foiId/history')
  @ApiOperation({ summary: '상품 품질검사 이력', description: '상품의 품질검사 이력을 조회합니다.' })
  @ApiParam({ name: 'foiId', description: '주문처리 아이템 ID' })
  @ApiResponse({ status: 200, description: '품질검사 이력 조회 성공' })
  @ApiResponse({ status: 404, description: '주문처리 아이템을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async getInspectionHistory(@Param('foiId') foiId: string) {
    return this.inspectionService.getInspectionHistory(foiId);
  }

  @Get('metrics/quality')
  @ApiOperation({ summary: '품질 메트릭 조회', description: '품질검사 관련 메트릭과 통계를 조회합니다.' })
  @ApiQuery({ name: 'warehouseId', description: '창고 ID 필터', required: false })
  @ApiQuery({ name: 'dateFrom', description: '시작 날짜 (YYYY-MM-DD)', required: false })
  @ApiQuery({ name: 'dateTo', description: '종료 날짜 (YYYY-MM-DD)', required: false })
  @ApiQuery({ name: 'inspectorUserId', description: '검사자 사용자 ID 필터', required: false })
  @ApiResponse({ status: 200, description: '품질 메트릭 조회 성공' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async getQualityMetrics(
    @Query('warehouseId') warehouseId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('inspectorUserId') inspectorUserId?: string
  ) {
    const filters = {
      warehouseId,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      inspectorUserId
    };

    return this.inspectionService.getQualityMetrics(filters);
  }
}