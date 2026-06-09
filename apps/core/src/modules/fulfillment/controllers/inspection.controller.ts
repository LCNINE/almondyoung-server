import { Controller, Get, Post, Put, Body, Param, Query, UsePipes, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { InspectionService } from '../services/inspection.service';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';

const StartInspectionSchema = z.object({
  fulfillmentOrderId: z.string().uuid(),
  type: z.enum(['individual', 'batch']),
  inspectorUserId: z.string(),
});

const InspectItemSchema = z.object({
  sessionId: z.string(),
  foiId: z.string().uuid(),
  inspectedQty: z.number().int().min(0),
  approvedQty: z.number().int().min(0),
  rejectedQty: z.number().int().min(0).default(0),
  issues: z
    .array(
      z.object({
        type: z.enum(['quantity_mismatch', 'quality_issue', 'damage', 'wrong_item', 'other']),
        severity: z.enum(['minor', 'major', 'critical']),
        description: z.string(),
        qty: z.number().int().min(0).optional(),
        photos: z.array(z.string()).optional(),
      }),
    )
    .default([]),
  inspectorUserId: z.string(),
});

const ForceShipmentSchema = z.object({
  sessionId: z.string().uuid(),
  foiId: z.string().uuid(),
  reason: z.string().min(1),
  authorizedBy: z.string().min(1),
  forceQty: z.number().int().positive(),
  note: z.string().optional(),
});

const BulkApproveSchema = z.object({
  sessionId: z.string().uuid(),
  foiIds: z.array(z.string().uuid()).min(1),
  inspectorUserId: z.string(),
});

// sessionId 는 URL param 으로 받으므로 body 는 inspectorUserId 만
const CompleteSessionSchema = z.object({
  inspectorUserId: z.string(),
});

const ScanInspectionSchema = z.object({
  barcode: z.string().min(1),
  sessionId: z.string().uuid(),
  fulfillmentOrderId: z.string().uuid().optional(),
});

const InspectByScanSchema = z.object({
  barcode: z.string().min(1),
  sessionId: z.string().uuid(),
  inspectorUserId: z.string(),
  quantity: z.number().int().positive().default(1),
});

@ApiTags('Inspection')
@Controller('inspection')
export class InspectionController {
  constructor(private readonly inspectionService: InspectionService) {}

  @Post('sessions')
  @ApiOperation({ summary: '품질검사 세션 시작' })
  @UsePipes(new ZodValidationPipe(StartInspectionSchema))
  async startInspectionSession(@Body() dto: z.infer<typeof StartInspectionSchema>) {
    return this.inspectionService.startInspectionSession(dto);
  }

  @Get('sessions/:sessionId')
  @ApiOperation({ summary: '품질검사 세션 조회' })
  @ApiParam({ name: 'sessionId', description: '품질검사 세션 ID' })
  async getInspectionSession(@Param('sessionId') sessionId: string) {
    return this.inspectionService.getInspectionSession(sessionId);
  }

  @Post('sessions/:sessionId/complete')
  @ApiOperation({ summary: '품질검사 세션 완료' })
  @ApiParam({ name: 'sessionId', description: '품질검사 세션 ID' })
  @UsePipes(new ZodValidationPipe(CompleteSessionSchema))
  async completeInspectionSession(
    @Param('sessionId') sessionId: string,
    @Body() dto: z.infer<typeof CompleteSessionSchema>,
  ) {
    await this.inspectionService.completeInspectionSession(sessionId, dto.inspectorUserId);
    return { message: 'Inspection session completed successfully' };
  }

  @Post('items/inspect')
  @ApiOperation({ summary: '상품 품질검사' })
  @UsePipes(new ZodValidationPipe(InspectItemSchema))
  async inspectItem(@Body() dto: z.infer<typeof InspectItemSchema>) {
    return this.inspectionService.inspectItem(dto);
  }

  @Post('scan')
  @ApiOperation({ summary: '검수 바코드 스캔 (대상 FOI 조회)' })
  @UsePipes(new ZodValidationPipe(ScanInspectionSchema))
  async scanBarcode(@Body() dto: z.infer<typeof ScanInspectionSchema>) {
    return this.inspectionService.scanBarcode(dto.barcode, {
      sessionId: dto.sessionId,
      fulfillmentOrderId: dto.fulfillmentOrderId,
    });
  }

  @Post('inspect-by-scan')
  @ApiOperation({ summary: '검수 바코드 스캔 (스캔 1회 = approved +수량 누적)' })
  @UsePipes(new ZodValidationPipe(InspectByScanSchema))
  async inspectByScan(@Body() dto: z.infer<typeof InspectByScanSchema>) {
    return this.inspectionService.inspectByScan(dto);
  }

  @Post('items/force-shipment')
  @ApiOperation({ summary: '강제 배송 승인' })
  @UsePipes(new ZodValidationPipe(ForceShipmentSchema))
  async forceShipment(@Body() dto: z.infer<typeof ForceShipmentSchema>) {
    await this.inspectionService.forceShipment(dto);
    return { message: 'Forced shipment authorized successfully' };
  }

  @Put('items/:foiId/reset')
  @ApiOperation({ summary: '품질검사 재설정' })
  @ApiParam({ name: 'foiId', description: '주문처리 아이템 ID' })
  @ApiQuery({ name: 'inspectorUserId', description: '검사자 사용자 ID', required: true })
  async resetInspection(@Param('foiId') foiId: string, @Query('inspectorUserId') inspectorUserId: string) {
    if (!inspectorUserId) {
      throw new BadRequestException('inspectorUserId is required');
    }
    await this.inspectionService.resetInspection(foiId, inspectorUserId);
    return { message: 'Inspection reset successfully' };
  }

  @Post('items/bulk-approve')
  @ApiOperation({ summary: '상품 일괄 승인' })
  @UsePipes(new ZodValidationPipe(BulkApproveSchema))
  async bulkApprove(@Body() dto: z.infer<typeof BulkApproveSchema>) {
    const approvedCount = await this.inspectionService.bulkApprove(dto.sessionId, dto.foiIds, dto.inspectorUserId);
    return { message: `Successfully approved ${approvedCount} items`, approvedCount };
  }

  @Get('fulfillment-orders/:foId/summary')
  @ApiOperation({ summary: '주문처리 품질검사 요약' })
  @ApiParam({ name: 'foId', description: '주문처리 ID' })
  async getInspectionSummary(@Param('foId') fulfillmentOrderId: string) {
    return this.inspectionService.getInspectionSummary(fulfillmentOrderId);
  }

  @Get('items/:foiId/history')
  @ApiOperation({ summary: '상품 품질검사 이력' })
  @ApiParam({ name: 'foiId', description: '주문처리 아이템 ID' })
  async getInspectionHistory(@Param('foiId') foiId: string) {
    return this.inspectionService.getInspectionHistory(foiId);
  }

  @Get('metrics/quality')
  @ApiOperation({ summary: '품질 메트릭 조회' })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'inspectorUserId', required: false })
  async getQualityMetrics(
    @Query('warehouseId') warehouseId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('inspectorUserId') inspectorUserId?: string,
  ) {
    return this.inspectionService.getQualityMetrics({
      warehouseId,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      inspectorUserId,
    });
  }
}
