import { Controller, Get, Post, Put, Body, Param, UsePipes } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { PickingProcessService } from '../services/picking-process.service';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';

const PickItemSchema = z.object({
  batchId: z.string().uuid(),
  skuId: z.string().uuid(),
  pickedQty: z.number().int().positive(),
  locationCode: z.string().optional(),
  pickerUserId: z.string().optional(),
});

const PickIndividualItemSchema = z.object({
  pickedQty: z.number().int().positive(),
  pickerUserId: z.string().optional(),
});

const ScanBarcodeSchema = z.object({
  barcode: z.string().min(1),
  batchId: z.string().uuid().optional(),
  fulfillmentOrderId: z.string().uuid().optional(),
  warehouseId: z.string().uuid(),
  pickerUserId: z.string().optional(),
});

const PickByBarcodeSchema = z.object({
  barcode: z.string().min(1),
  pickedQty: z.number().int().positive(),
  batchId: z.string().uuid().optional(),
  fulfillmentOrderId: z.string().uuid().optional(),
  warehouseId: z.string().uuid(),
  pickerUserId: z.string().optional(),
  locationCode: z.string().optional(),
});

const GenerateBarcodeSchema = z.object({
  type: z.enum(['sku', 'foi', 'fo']),
  id: z.string().uuid(),
});

@ApiTags('Picking')
@Controller('picking')
export class PickingController {
  constructor(private readonly pickingProcessService: PickingProcessService) {}

  @Get('batches/:batchId/operations')
  @ApiOperation({ summary: '배치별 피킹 작업 조회' })
  @ApiParam({ name: 'batchId', description: '배치 ID' })
  async getPickingOperations(@Param('batchId') batchId: string) {
    return this.pickingProcessService.getPickingOperations(batchId);
  }

  @Get('batches/:batchId/progress')
  @ApiOperation({ summary: '배치별 피킹 진행률 조회' })
  @ApiParam({ name: 'batchId', description: '배치 ID' })
  async getPickingProgress(@Param('batchId') batchId: string) {
    return this.pickingProcessService.getPickingProgress(batchId);
  }

  @Post('batch-pick')
  @ApiOperation({ summary: '배치 피킹' })
  @UsePipes(new ZodValidationPipe(PickItemSchema))
  async pickItem(@Body() dto: z.infer<typeof PickItemSchema>) {
    await this.pickingProcessService.pickItem(dto);
    return { message: 'Item picked successfully' };
  }

  @Post('fulfillment-orders/:foId/start')
  @ApiOperation({ summary: '개별 피킹 시작' })
  @ApiParam({ name: 'foId', description: '주문처리 ID' })
  async startIndividualPicking(@Param('foId') fulfillmentOrderId: string) {
    return this.pickingProcessService.startIndividualPicking(fulfillmentOrderId);
  }

  @Get('fulfillment-orders/:foId/session')
  @ApiOperation({ summary: '개별 피킹 세션 조회' })
  @ApiParam({ name: 'foId', description: '주문처리 ID' })
  async getIndividualPickingSession(@Param('foId') fulfillmentOrderId: string) {
    return this.pickingProcessService.startIndividualPicking(fulfillmentOrderId);
  }

  @Post('fulfillment-order-items/:foiId/pick')
  @ApiOperation({ summary: '개별 아이템 피킹' })
  @ApiParam({ name: 'foiId', description: '주문처리 라인 ID' })
  @UsePipes(new ZodValidationPipe(PickIndividualItemSchema))
  async pickIndividualItem(@Param('foiId') foiId: string, @Body() dto: z.infer<typeof PickIndividualItemSchema>) {
    await this.pickingProcessService.pickIndividualItem(foiId, dto.pickedQty, dto.pickerUserId);
    return { message: 'Individual item picked successfully' };
  }

  @Post('fulfillment-orders/:foId/complete')
  @ApiOperation({ summary: '개별 피킹 완료' })
  @ApiParam({ name: 'foId', description: '주문처리 ID' })
  async completeIndividualPicking(@Param('foId') fulfillmentOrderId: string) {
    await this.pickingProcessService.completeIndividualPicking(fulfillmentOrderId);
    return { message: 'Individual picking completed successfully' };
  }

  @Put('fulfillment-order-items/:foiId/reset')
  @ApiOperation({ summary: '피킹 리셋' })
  @ApiParam({ name: 'foiId', description: '주문처리 라인 ID' })
  async resetPickingForItem(@Param('foiId') foiId: string) {
    await this.pickingProcessService.resetPickingForItem(foiId);
    return { message: 'Picking reset successfully' };
  }

  @Post('scan')
  @ApiOperation({ summary: '바코드 스캔' })
  @UsePipes(new ZodValidationPipe(ScanBarcodeSchema))
  async scanBarcode(@Body() dto: z.infer<typeof ScanBarcodeSchema>) {
    return this.pickingProcessService.scanBarcode(dto.barcode, {
      batchId: dto.batchId,
      fulfillmentOrderId: dto.fulfillmentOrderId,
      warehouseId: dto.warehouseId,
      pickerUserId: dto.pickerUserId,
    });
  }

  @Post('pick-by-scan')
  @ApiOperation({ summary: '바코드 스캔으로 피킹' })
  @UsePipes(new ZodValidationPipe(PickByBarcodeSchema))
  async pickByBarcodeScan(@Body() dto: z.infer<typeof PickByBarcodeSchema>) {
    return this.pickingProcessService.pickByBarcodeScan(dto.barcode, dto.pickedQty, {
      batchId: dto.batchId,
      fulfillmentOrderId: dto.fulfillmentOrderId,
      warehouseId: dto.warehouseId,
      pickerUserId: dto.pickerUserId,
      locationCode: dto.locationCode,
    });
  }

  @Post('generate-barcode')
  @ApiOperation({ summary: '바코드 생성' })
  @UsePipes(new ZodValidationPipe(GenerateBarcodeSchema))
  async generateBarcode(@Body() dto: z.infer<typeof GenerateBarcodeSchema>) {
    return this.pickingProcessService.getBarcodeForPicking({ type: dto.type, id: dto.id });
  }
}
