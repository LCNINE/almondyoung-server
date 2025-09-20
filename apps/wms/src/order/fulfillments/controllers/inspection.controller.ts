import { Controller, Get, Post, Put, Body, Param, Query, UsePipes } from '@nestjs/common';
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

@Controller('wms/inspection')
export class InspectionController {
  constructor(
    private readonly inspectionService: InspectionService
  ) {}

  @Post('sessions')
  @UsePipes(new ZodValidationPipe(StartInspectionSchema))
  async startInspectionSession(@Body() dto: z.infer<typeof StartInspectionSchema>) {
    return this.inspectionService.startInspectionSession(dto);
  }

  @Post('sessions/:sessionId/complete')
  @UsePipes(new ZodValidationPipe(CompleteSessionSchema))
  async completeInspectionSession(
    @Param('sessionId') sessionId: string,
    @Body() dto: z.infer<typeof CompleteSessionSchema>
  ) {
    await this.inspectionService.completeInspectionSession(sessionId, dto.inspectorUserId);
    return { message: 'Inspection session completed successfully' };
  }

  @Post('items/inspect')
  @UsePipes(new ZodValidationPipe(InspectItemSchema))
  async inspectItem(@Body() dto: z.infer<typeof InspectItemSchema>) {
    return this.inspectionService.inspectItem(dto);
  }

  @Post('items/force-shipment')
  @UsePipes(new ZodValidationPipe(ForceShipmentSchema))
  async forceShipment(@Body() dto: z.infer<typeof ForceShipmentSchema>) {
    await this.inspectionService.forceShipment(dto);
    return { message: 'Forced shipment authorized successfully' };
  }

  @Put('items/:foiId/reset')
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
  @UsePipes(new ZodValidationPipe(BulkApproveSchema))
  async bulkApprove(@Body() dto: z.infer<typeof BulkApproveSchema>) {
    const approvedCount = await this.inspectionService.bulkApprove(dto.foiIds, dto.inspectorUserId);
    return {
      message: `Successfully approved ${approvedCount} items`,
      approvedCount
    };
  }

  @Get('fulfillment-orders/:foId/summary')
  async getInspectionSummary(@Param('foId') fulfillmentOrderId: string) {
    return this.inspectionService.getInspectionSummary(fulfillmentOrderId);
  }

  @Get('items/:foiId/history')
  async getInspectionHistory(@Param('foiId') foiId: string) {
    return this.inspectionService.getInspectionHistory(foiId);
  }

  @Get('metrics/quality')
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