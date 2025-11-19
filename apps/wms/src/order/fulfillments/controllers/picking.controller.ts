import { Controller, Get, Post, Put, Body, Param, Query, UsePipes } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
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

@ApiTags('Picking')
@Controller('picking')
export class PickingController {
  constructor(
    private readonly pickingProcessService: PickingProcessService
  ) {}

  @Get('batches/:batchId/operations')
  @ApiOperation({ summary: '배치별 피킹 작업 조회', description: '특정 배치의 피킹 작업 목록을 조회합니다.' })
  @ApiParam({ name: 'batchId', description: '배치 ID' })
  @ApiResponse({ status: 200, description: '피킹 작업 목록 조회 성공' })
  @ApiResponse({ status: 404, description: '배치를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async getPickingOperations(@Param('batchId') batchId: string) {
    return this.pickingProcessService.getPickingOperations(batchId);
  }

  @Get('batches/:batchId/progress')
  @ApiOperation({ summary: '배치별 피킹 진행률 조회', description: '특정 배치의 피킹 진행 상황을 조회합니다.' })
  @ApiParam({ name: 'batchId', description: '배치 ID' })
  @ApiResponse({ status: 200, description: '피킹 진행률 조회 성공' })
  @ApiResponse({ status: 404, description: '배치를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async getPickingProgress(@Param('batchId') batchId: string) {
    return this.pickingProcessService.getPickingProgress(batchId);
  }

  @Post('batch-pick')
  @ApiOperation({ summary: '배치 피킹', description: '배치 단위로 아이템을 피킹합니다.' })
  @ApiBody({
    description: '배치 피킹 데이터',
    schema: {
      type: 'object',
      properties: {
        batchId: { type: 'string', format: 'uuid', description: '배치 ID' },
        skuId: { type: 'string', format: 'uuid', description: 'SKU ID' },
        pickedQty: { type: 'number', description: '피킹된 수량' },
        locationCode: { type: 'string', description: '위치 코드 (선택사항)' },
        pickerUserId: { type: 'string', description: '피커 사용자 ID (선택사항)' }
      },
      required: ['batchId', 'skuId', 'pickedQty']
    }
  })
  @ApiResponse({ status: 200, description: '아이템 피킹 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '배치 또는 SKU를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  @UsePipes(new ZodValidationPipe(PickItemSchema))
  async pickItem(@Body() dto: z.infer<typeof PickItemSchema>) {
    await this.pickingProcessService.pickItem(dto);
    return { message: 'Item picked successfully' };
  }

  @Post('fulfillment-orders/:foId/start')
  @ApiOperation({ summary: '개별 피킹 시작', description: '특정 주문처리의 개별 피킹을 시작합니다.' })
  @ApiParam({ name: 'foId', description: '주문처리 ID' })
  @ApiResponse({ status: 200, description: '개별 피킹 시작 성공' })
  @ApiResponse({ status: 404, description: '주문처리를 찾을 수 없음' })
  @ApiResponse({ status: 400, description: '피킹을 시작할 수 없는 상태' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async startIndividualPicking(@Param('foId') fulfillmentOrderId: string) {
    return this.pickingProcessService.startIndividualPicking(fulfillmentOrderId);
  }

  @Get('fulfillment-orders/:foId/session')
  @ApiOperation({ summary: '개별 피킹 세션 조회', description: '특정 주문처리의 피킹 세션 정보를 조회합니다.' })
  @ApiParam({ name: 'foId', description: '주문처리 ID' })
  @ApiResponse({ status: 200, description: '피킹 세션 조회 성공' })
  @ApiResponse({ status: 404, description: '주문처리를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async getIndividualPickingSession(@Param('foId') fulfillmentOrderId: string) {
    return this.pickingProcessService.startIndividualPicking(fulfillmentOrderId);
  }

  @Post('fulfillment-order-items/:foiId/pick')
  @ApiOperation({ summary: '개별 아이템 피킹', description: '주문처리 라인의 개별 아이템을 피킹합니다.' })
  @ApiParam({ name: 'foiId', description: '주문처리 라인 ID' })
  @ApiBody({
    description: '개별 아이템 피킹 데이터',
    schema: {
      type: 'object',
      properties: {
        pickedQty: { type: 'number', description: '피킹된 수량' }
      },
      required: ['pickedQty']
    }
  })
  @ApiResponse({ status: 200, description: '개별 아이템 피킹 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '주문처리 라인을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  @UsePipes(new ZodValidationPipe(PickIndividualItemSchema))
  async pickIndividualItem(
    @Param('foiId') foiId: string,
    @Body() dto: z.infer<typeof PickIndividualItemSchema>
  ) {
    await this.pickingProcessService.pickIndividualItem(foiId, dto.pickedQty);
    return { message: 'Individual item picked successfully' };
  }

  @Post('fulfillment-orders/:foId/complete')
  @ApiOperation({ summary: '개별 피킹 완료', description: '특정 주문처리의 개별 피킹을 완료합니다.' })
  @ApiParam({ name: 'foId', description: '주문처리 ID' })
  @ApiResponse({ status: 200, description: '개별 피킹 완료 성공' })
  @ApiResponse({ status: 404, description: '주문처리를 찾을 수 없음' })
  @ApiResponse({ status: 400, description: '완료할 수 없는 상태' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async completeIndividualPicking(@Param('foId') fulfillmentOrderId: string) {
    await this.pickingProcessService.completeIndividualPicking(fulfillmentOrderId);
    return { message: 'Individual picking completed successfully' };
  }

  @Put('fulfillment-order-items/:foiId/reset')
  @ApiOperation({ summary: '피킹 리셋', description: '주문처리 라인의 피킹 상태를 리셋합니다.' })
  @ApiParam({ name: 'foiId', description: '주문처리 라인 ID' })
  @ApiResponse({ status: 200, description: '피킹 리셋 성공' })
  @ApiResponse({ status: 404, description: '주문처리 라인을 찾을 수 없음' })
  @ApiResponse({ status: 400, description: '리셋할 수 없는 상태' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async resetPickingForItem(@Param('foiId') foiId: string) {
    await this.pickingProcessService.resetPickingForItem(foiId);
    return { message: 'Picking reset successfully' };
  }

  // 바코드 스캔 엔드포인트들

  @Post('scan')
  @ApiOperation({ summary: '바코드 스캔', description: '피킹 작업을 위해 바코드를 스캔합니다.' })
  @ApiBody({
    description: '바코드 스캔 데이터',
    schema: {
      type: 'object',
      properties: {
        barcode: { type: 'string', description: '스캔할 바코드' },
        batchId: { type: 'string', format: 'uuid', description: '배치 ID (선택사항)' },
        fulfillmentOrderId: { type: 'string', format: 'uuid', description: '주문처리 ID (선택사항)' },
        warehouseId: { type: 'string', format: 'uuid', description: '창고 ID' },
        pickerUserId: { type: 'string', description: '피커 사용자 ID (선택사항)' }
      },
      required: ['barcode', 'warehouseId']
    }
  })
  @ApiResponse({ status: 200, description: '바코드 스캔 성공' })
  @ApiResponse({ status: 400, description: '잘못된 바코드 또는 요청 데이터' })
  @ApiResponse({ status: 404, description: '바코드에 해당하는 아이템을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
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
  @ApiOperation({ summary: '바코드 스캔으로 피킹', description: '바코드를 스캔하여 직접 아이템을 피킹합니다.' })
  @ApiBody({
    description: '바코드 피킹 데이터',
    schema: {
      type: 'object',
      properties: {
        barcode: { type: 'string', description: '스캔할 바코드' },
        pickedQty: { type: 'number', description: '피킹된 수량' },
        batchId: { type: 'string', format: 'uuid', description: '배치 ID (선택사항)' },
        fulfillmentOrderId: { type: 'string', format: 'uuid', description: '주문처리 ID (선택사항)' },
        warehouseId: { type: 'string', format: 'uuid', description: '창고 ID' },
        pickerUserId: { type: 'string', description: '피커 사용자 ID (선택사항)' },
        locationCode: { type: 'string', description: '위치 코드 (선택사항)' }
      },
      required: ['barcode', 'pickedQty', 'warehouseId']
    }
  })
  @ApiResponse({ status: 200, description: '바코드 피킹 성공' })
  @ApiResponse({ status: 400, description: '잘못된 바코드 또는 요청 데이터' })
  @ApiResponse({ status: 404, description: '바코드에 해당하는 아이템을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
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
  @ApiOperation({ summary: '바코드 생성', description: '피킹 작업을 위한 바코드를 생성합니다.' })
  @ApiBody({
    description: '바코드 생성 데이터',
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['sku', 'foi', 'fo'], description: '바코드 타입 (sku: SKU, foi: 주문처리라인, fo: 주문처리)' },
        id: { type: 'string', format: 'uuid', description: '대상 ID' }
      },
      required: ['type', 'id']
    }
  })
  @ApiResponse({ status: 200, description: '바코드 생성 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '대상 아이템을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  @UsePipes(new ZodValidationPipe(GenerateBarcodeSchema))
  async generateBarcode(@Body() dto: z.infer<typeof GenerateBarcodeSchema>) {
    return this.pickingProcessService.getBarcodeForPicking({
      type: dto.type,
      id: dto.id
    });
  }
}