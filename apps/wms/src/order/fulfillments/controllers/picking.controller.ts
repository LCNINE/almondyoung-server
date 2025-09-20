import { Controller, Get, Post, Put, Body, Param, Query, UsePipes } from '@nestjs/common';
import { PickingProcessService } from '../../shared/services/picking-process.service';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';

const PickItemSchema = z.object({
  batchId: z.string().uuid(),
  skuId: z.string().uuid(),
  pickedQty: z.number().int().positive(),
  locationCode: z.string().optional(),
  pickerUserId: z.string().optional()
});

const PickIndividualItemSchema = z.object({
  pickedQty: z.number().int().positive()
});

const ScanBarcodeSchema = z.object({
  barcode: z.string().min(1),
  batchId: z.string().uuid().optional(),
  fulfillmentOrderId: z.string().uuid().optional(),
  warehouseId: z.string().uuid(),
  pickerUserId: z.string().optional()
});

const PickByBarcodeSchema = z.object({
  barcode: z.string().min(1),
  pickedQty: z.number().int().positive(),
  batchId: z.string().uuid().optional(),
  fulfillmentOrderId: z.string().uuid().optional(),
  warehouseId: z.string().uuid(),
  pickerUserId: z.string().optional(),
  locationCode: z.string().optional()
});

const GenerateBarcodeSchema = z.object({
  type: z.enum(['sku', 'foi', 'fo']),
  id: z.string().uuid()
});

@Controller('wms/picking')
export class PickingController {
  constructor(
    private readonly pickingProcessService: PickingProcessService
  ) {}

  @Get('batches/:batchId/operations')
  async getPickingOperations(@Param('batchId') batchId: string) {
    return this.pickingProcessService.getPickingOperations(batchId);
  }

  @Get('batches/:batchId/progress')
  async getPickingProgress(@Param('batchId') batchId: string) {
    return this.pickingProcessService.getPickingProgress(batchId);
  }

  @Post('batch-pick')
  @UsePipes(new ZodValidationPipe(PickItemSchema))
  async pickItem(@Body() dto: z.infer<typeof PickItemSchema>) {
    await this.pickingProcessService.pickItem(dto);
    return { message: 'Item picked successfully' };
  }

  @Post('fulfillment-orders/:foId/start')
  async startIndividualPicking(@Param('foId') fulfillmentOrderId: string) {
    return this.pickingProcessService.startIndividualPicking(fulfillmentOrderId);
  }

  @Get('fulfillment-orders/:foId/session')
  async getIndividualPickingSession(@Param('foId') fulfillmentOrderId: string) {
    return this.pickingProcessService.startIndividualPicking(fulfillmentOrderId);
  }

  @Post('fulfillment-order-items/:foiId/pick')
  @UsePipes(new ZodValidationPipe(PickIndividualItemSchema))
  async pickIndividualItem(
    @Param('foiId') foiId: string,
    @Body() dto: z.infer<typeof PickIndividualItemSchema>
  ) {
    await this.pickingProcessService.pickIndividualItem(foiId, dto.pickedQty);
    return { message: 'Individual item picked successfully' };
  }

  @Post('fulfillment-orders/:foId/complete')
  async completeIndividualPicking(@Param('foId') fulfillmentOrderId: string) {
    await this.pickingProcessService.completeIndividualPicking(fulfillmentOrderId);
    return { message: 'Individual picking completed successfully' };
  }

  @Put('fulfillment-order-items/:foiId/reset')
  async resetPickingForItem(@Param('foiId') foiId: string) {
    await this.pickingProcessService.resetPickingForItem(foiId);
    return { message: 'Picking reset successfully' };
  }

  // 바코드 스캔 엔드포인트들

  @Post('scan')
  @UsePipes(new ZodValidationPipe(ScanBarcodeSchema))
  async scanBarcode(@Body() dto: z.infer<typeof ScanBarcodeSchema>) {
    return this.pickingProcessService.scanBarcode(dto.barcode, {
      batchId: dto.batchId,
      fulfillmentOrderId: dto.fulfillmentOrderId,
      warehouseId: dto.warehouseId,
      pickerUserId: dto.pickerUserId
    });
  }

  @Post('pick-by-scan')
  @UsePipes(new ZodValidationPipe(PickByBarcodeSchema))
  async pickByBarcodeScan(@Body() dto: z.infer<typeof PickByBarcodeSchema>) {
    return this.pickingProcessService.pickByBarcodeScan(dto.barcode, dto.pickedQty, {
      batchId: dto.batchId,
      fulfillmentOrderId: dto.fulfillmentOrderId,
      warehouseId: dto.warehouseId,
      pickerUserId: dto.pickerUserId,
      locationCode: dto.locationCode
    });
  }

  @Post('generate-barcode')
  @UsePipes(new ZodValidationPipe(GenerateBarcodeSchema))
  async generateBarcode(@Body() dto: z.infer<typeof GenerateBarcodeSchema>) {
    return this.pickingProcessService.getBarcodeForPicking({
      type: dto.type,
      id: dto.id
    });
  }
}