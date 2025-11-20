import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Query,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Patch,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { InventoryService } from '../services/inventory.service';
import { StockEventService } from '../services/stock-event.service';
import { SafetyStockService } from '../services/safety-stock.service';
import { AdjustStockDto } from '../dto/inventory/adjust-stock.dto';
import { GetStockQueryDto } from '../dto/inventory/get-stock-query.dto';
import { AdvancedInventoryFiltersDto } from '../dto/inventory/advanced-filters.dto';
import { CreateSkuDto } from '../dto/sku/create-sku.dto';
import { UpdateSkuDto } from '../dto/sku/update-sku.dto';
import { AddBarcodeDto } from '../dto/sku/add-barcode.dto';
import { SkuResponseDto } from '../dto/sku/sku-response.dto';
import { SkuStockSummaryDto } from '../dto/sku/sku-stock-summary.dto';
import { UpdateWarehouseDto } from '../dto/warehouse/update-warehouse.dto';
import { CreateWarehouseDto } from '../dto/warehouse/create-warehouse.dto';
import { CreateStockEntryBySkuIdDto } from '../../inbound/dto/create-stock-entry-by-skuid.dto';

@ApiTags('Inventory')
@Controller('wms/inventory')
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly stockEventService: StockEventService,
    private readonly safetyStockService: SafetyStockService,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // 재고 관리 API
  // ═══════════════════════════════════════════════════════════════

  @Get('/stocks')
  @ApiOperation({
    summary: '현재 재고 조회 (SKU, 창고, 위치, 재고 유형, 특정 시점 기준)',
  })
  @ApiQuery({
    name: 'skuId',
    required: false,
    description: '검색할 SKU ID (UUID 형식)',
  })
  @ApiQuery({
    name: 'warehouseId',
    required: false,
    description: '검색할 창고 ID (UUID 형식)',
  })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description: '검색할 위치 ID (UUID 형식)',
  })
  @ApiQuery({
    name: 'stockType',
    required: false,
    enum: ['physical', 'infinite', 'drop_shipped', 'consignment'],
    description: '재고 유형 필터',
  })
  @ApiQuery({
    name: 'asOfTimestamp',
    required: false,
    description: '특정 시점의 재고 조회 (ISO 8601 형식)',
  })
  @ApiResponse({ status: 200, description: '현재 재고 정보를 반환합니다.' })
  async getCurrentStock(@Query() query: GetStockQueryDto) {
    return this.inventoryService.getCurrentStock(query);
  }

  @Get('/stocks/summary')
  @ApiOperation({ summary: '재고 현황 요약 조회 (이중 원장 기반 빠른 조회)' })
  @ApiQuery({ name: 'skuId', required: false, description: 'SKU ID로 필터링' })
  @ApiQuery({
    name: 'warehouseId',
    required: false,
    description: '창고 ID로 필터링',
  })
  @ApiResponse({
    status: 200,
    description: '재고 현황 요약 정보를 반환합니다.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          skuId: { type: 'string' },
          skuName: { type: 'string' },
          warehouseId: { type: 'string' },
          warehouseName: { type: 'string' },
          currentQuantity: { type: 'number' },
          availableQuantity: { type: 'number' },
          reservedQuantity: { type: 'number' },
          inboundPendingQuantity: { type: 'number' },
          outboundPendingQuantity: { type: 'number' },
          lastUpdated: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  async getQuickStockSummary(
    @Query('skuId') skuId?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.inventoryService.getQuickStockSummary(skuId, warehouseId);
  }

  @Get('/stocks/sku/:skuId/total')
  @ApiOperation({ summary: 'SKU별 총 재고 조회 (모든 창고 합계)' })
  @ApiResponse({
    status: 200,
    description: 'SKU의 총 재고 정보를 반환합니다.',
    schema: {
      type: 'object',
      properties: {
        skuId: { type: 'string' },
        totalRealQuantity: { type: 'number' },
        totalReservedQuantity: { type: 'number' },
        totalAvailableQuantity: { type: 'number' },
      },
    },
  })
  async getTotalStockBySku(@Param('skuId') skuId: string) {
    return this.inventoryService.getTotalStockBySku(skuId);
  }

  @Get('/stocks/sku/:skuId/warehouse/:warehouseId')
  @ApiOperation({ summary: '특정 창고의 SKU별 재고 상세 조회' })
  @ApiResponse({
    status: 200,
    description: '창고별 SKU 재고 상세 정보를 반환합니다.',
    schema: {
      type: 'object',
      properties: {
        summary: {
          type: 'object',
          properties: {
            currentQuantity: { type: 'number' },
            availableQuantity: { type: 'number' },
            reservedQuantity: { type: 'number' },
            inboundPendingQuantity: { type: 'number' },
            outboundPendingQuantity: { type: 'number' },
            movingQuantity: { type: 'number' },
            defectiveQuantity: { type: 'number' },
            returnPendingQuantity: { type: 'number' },
            lastUpdated: { type: 'string', format: 'date-time' },
          },
        },
        details: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              realQuantity: { type: 'number' },
              reservedQuantity: { type: 'number' },
              availableQuantity: { type: 'number' },
              location: { type: 'object' },
              expiryDate: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  })
  async getStockBySkuAndWarehouse(
    @Param('skuId') skuId: string,
    @Param('warehouseId') warehouseId: string,
  ) {
    return this.inventoryService.getStockBySkuAndWarehouse(skuId, warehouseId);
  }

  @Post('/stocks/adjust')
  @ApiOperation({ summary: '재고 수량 조정 (관리자 수동 조정)' })
  @ApiResponse({
    status: 200,
    description: '재고 수량이 성공적으로 조정되었습니다.',
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 또는 유효성 검사 실패.',
  })
  @ApiResponse({ status: 404, description: '활성 재고 항목을 찾을 수 없음.' })
  async adjustStockQuantity(@Body() adjustDto: AdjustStockDto) {
    return this.inventoryService.adjustStockManually(
      `${adjustDto.skuId}:${adjustDto.warehouseId}:${adjustDto.locationId ?? ''}`,
      adjustDto.delta,
      adjustDto.reason,
    );
  }

  @Post('/stocks/entry-safe')
  @ApiOperation({
    summary: '안전한 재고 입고 (SKU ID 기반)',
    description:
      '기존 SKU ID로만 재고를 입고합니다. 자동 SKU 생성을 하지 않아 데이터 무결성을 보장합니다.',
  })
  @ApiResponse({
    status: 201,
    description: '재고 입고가 성공적으로 처리되었습니다.',
  })
  @ApiResponse({
    status: 400,
    description: 'SKU를 찾을 수 없거나 잘못된 요청입니다.',
  })
  async createStockEntryBySkuId(@Body() dto: CreateStockEntryBySkuIdDto) {
    return this.stockEventService.createStockEntryBySkuId(dto);
  }

  @Get('/stocks/history')
  @ApiOperation({ summary: '재고 이벤트 이력 조회 (SKU, 창고, 기간 기준)' })
  @ApiQuery({
    name: 'skuId',
    required: true,
    description: '조회할 SKU ID (UUID 형식)',
  })
  @ApiQuery({
    name: 'warehouseId',
    required: false,
    description: '조회할 창고 ID (UUID 형식)',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: '조회 시작일 (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: '조회 종료일 (YYYY-MM-DD)',
  })
  @ApiResponse({
    status: 200,
    description: '재고 이벤트 이력 목록을 반환합니다.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          eventType: { type: 'string' },
          deltaQuantity: { type: 'number' },
          eventTimestamp: { type: 'string', format: 'date-time' },
          reason: { type: 'string' },
          orderId: { type: 'string' },
        },
      },
    },
  })
  async getStockHistory(
    @Query('skuId') skuId: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.inventoryService.getStockHistory(
      skuId,
      warehouseId,
      startDate,
      endDate,
    );
  }

  @Post('/stocks/summary/:skuId/:warehouseId/rebuild')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '재고 현황 재구축 (이벤트 소싱으로부터)' })
  @ApiParam({ name: 'skuId', description: 'SKU ID' })
  @ApiParam({ name: 'warehouseId', description: '창고 ID' })
  @ApiResponse({
    status: 204,
    description: '재고 현황이 성공적으로 재구축되었습니다.',
  })
  async rebuildStockSummary(
    @Param('skuId') skuId: string,
    @Param('warehouseId') warehouseId: string,
  ) {
    await this.inventoryService.rebuildStockSummary(skuId, warehouseId);
  }

  @Delete('/stocks/events/:eventId/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '재고 이벤트 취소 (반대 이벤트 생성)' })
  @ApiParam({ name: 'eventId', description: '취소할 이벤트 ID' })
  @ApiResponse({
    status: 204,
    description: '이벤트가 성공적으로 취소되었습니다.',
  })
  async cancelStockEvent(
    @Param('eventId') eventId: string,
    @Body('reason') reason: string,
  ) {
    await this.inventoryService.cancelStockEvent(eventId, reason);
  }

  // ═══════════════════════════════════════════════════════════════
  // SKU 관리 API
  // ═══════════════════════════════════════════════════════════════

  @Post('/skus')
  @ApiOperation({ summary: 'SKU 생성' })
  @ApiResponse({
    status: 201,
    description: 'SKU가 성공적으로 생성되었습니다.',
    type: SkuResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  async createSku(@Body() createSkuDto: CreateSkuDto): Promise<SkuResponseDto> {
    try {
      return await this.inventoryService.createSku(createSkuDto);
    } catch (error) {
      // 외래키 제약조건 위반 에러 처리
      if (
        error.message?.includes('foreign key') ||
        error.message?.includes('violates foreign key constraint')
      ) {
        throw new BadRequestException(
          `Invalid reference: ${error.message.includes('delivery_profile') ? 'deliveryProfileId' : error.message.includes('supplier') ? 'supplierIds' : error.message.includes('category') ? 'categoryIds' : 'referenced ID'} does not exist`,
        );
      }
      // 기존 에러 메시지 패턴 기반 처리
      if (error.message?.includes('not found')) {
        throw new BadRequestException(error.message);
      }
      if (
        error.message?.includes('already exists') ||
        error.message?.includes('duplicate')
      ) {
        throw new BadRequestException(error.message);
      }
      if (
        error.message?.includes('required') ||
        error.message?.includes('invalid')
      ) {
        throw new BadRequestException(error.message);
      }
      // 그 외 에러는 그대로 전파
      throw error;
    }
  }

  @Get('/skus')
  @ApiOperation({ summary: 'SKU 검색' })
  @ApiQuery({
    name: 'id',
    required: false,
    description: 'SKU ID (정확히 일치)',
  })
  @ApiQuery({
    name: 'code',
    required: false,
    description: 'SKU 코드 (정확히 일치)',
  })
  @ApiQuery({
    name: 'barcode',
    required: false,
    description: 'SKU 기본 바코드 또는 서브 바코드',
  })
  @ApiQuery({
    name: 'name',
    required: false,
    description: 'SKU 이름 (부분 일치)',
  })
  @ApiQuery({
    name: 'supplierName',
    required: false,
    description: '공급사 이름 (부분 일치)',
  })
  @ApiQuery({
    name: 'masterId',
    required: false,
    description: '마스터 ID (정확히 일치)',
  })
  @ApiResponse({
    status: 200,
    description: '검색된 SKU 목록',
    type: [SkuResponseDto],
  })
  async searchSkus(
    @Query('id') id?: string,
    @Query('code') code?: string,
    @Query('barcode') barcode?: string,
    @Query('name') name?: string,
    @Query('supplierName') supplierName?: string,
    @Query('masterId') masterId?: string,
  ): Promise<SkuResponseDto[]> {
    return this.inventoryService.searchSkus({
      id,
      code,
      barcode,
      name,
      supplierName,
      masterId,
    });
  }

  @Get('/skus/search/advanced')
  @ApiOperation({
    summary:
      '고급 재고 검색 (Advanced inventory search with comprehensive filtering and stock information)',
    description:
      'SKU 정보와 재고 정보를 함께 조회하는 고급 검색 API. 다양한 필터 옵션을 제공하며, 각 SKU의 현재 재고 수량(currentStock)을 포함합니다. warehouseId 필터가 제공되면 해당 창고의 재고만 합산하고, 없으면 모든 창고의 재고를 합산합니다.',
  })
  @ApiResponse({
    status: 200,
    description:
      '검색 결과 (Search results with pagination and stock information)',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'SKU ID (UUID)' },
              name: { type: 'string', description: 'SKU 이름' },
              code: { type: 'string', description: 'SKU 코드' },
              defaultBarcode: {
                type: 'string',
                nullable: true,
                description: '기본 바코드',
              },
              deliveryProfileId: {
                type: 'string',
                nullable: true,
                description: '배송 프로필 ID',
              },
              sale1m: {
                type: 'number',
                nullable: true,
                description: '1개월 판매량',
              },
              sale3m: {
                type: 'number',
                nullable: true,
                description: '3개월 판매량',
              },
              safetyStock: {
                type: 'number',
                description: '안전 재고',
                example: 10,
              },
              currentStock: {
                type: 'number',
                description:
                  '현재 재고 수량 (warehouseId 필터가 있으면 해당 창고만, 없으면 모든 창고 합계)',
                example: 150,
                default: 0,
              },
              masterId: { type: 'string', description: '마스터 ID' },
              optionKey: {
                type: 'string',
                nullable: true,
                description: '옵션 식별자',
                example: 'M / 흰색',
              },
              master: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: '마스터 ID' },
                  name: { type: 'string', description: '마스터 이름' },
                  code: { type: 'string', description: '마스터 코드' },
                  hasOptions: {
                    type: 'boolean',
                    description: '옵션 존재 여부',
                  },
                },
              },
              barcodes: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: '바코드 ID' },
                    barcode: { type: 'string', description: '바코드 값' },
                    barcodeType: { type: 'string', description: '바코드 타입' },
                    packingUnit: {
                      type: 'string',
                      nullable: true,
                      description: '포장 단위',
                    },
                  },
                },
                description: '바코드 목록',
              },
              supplierNames: {
                type: 'array',
                items: { type: 'string' },
                description: '공급처 이름 목록',
              },
              categoryNames: {
                type: 'array',
                items: { type: 'string' },
                description: '카테고리 이름 목록',
              },
              mainImageUrl: {
                type: 'string',
                nullable: true,
                description: '메인 이미지 URL',
              },
              createdAt: {
                type: 'string',
                format: 'date-time',
                description: '생성일시',
              },
              updatedAt: {
                type: 'string',
                format: 'date-time',
                description: '수정일시',
              },
            },
          },
          description: 'SKU 목록 (재고 정보 포함)',
        },
        total: {
          type: 'number',
          description: '전체 결과 수',
          example: 150,
        },
        limit: {
          type: 'number',
          description: '페이지 크기',
          example: 50,
        },
        offset: {
          type: 'number',
          description: '페이지 오프셋',
          example: 0,
        },
      },
    },
  })
  async searchInventoryAdvanced(
    @Query() filters: AdvancedInventoryFiltersDto,
  ): Promise<{
    items: SkuResponseDto[];
    total: number;
    limit: number;
    offset: number;
  }> {
    return this.inventoryService.searchInventoryAdvanced(filters);
  }

  @Get('/skus/:id')
  @ApiOperation({ summary: 'SKU 상세 조회' })
  @ApiParam({ name: 'id', description: 'SKU ID' })
  @ApiResponse({
    status: 200,
    description: 'SKU 상세 정보',
    type: SkuResponseDto,
  })
  @ApiResponse({ status: 404, description: 'SKU를 찾을 수 없습니다.' })
  async getSkuById(@Param('id') id: string): Promise<SkuResponseDto> {
    return this.inventoryService.getSkuById(id);
  }

  @Put('/skus/:id')
  @ApiOperation({ summary: 'SKU 수정' })
  @ApiParam({ name: 'id', description: 'SKU ID' })
  @ApiResponse({
    status: 200,
    description: 'SKU가 성공적으로 수정되었습니다.',
    type: SkuResponseDto,
  })
  @ApiResponse({ status: 404, description: 'SKU를 찾을 수 없습니다.' })
  async updateSku(
    @Param('id') id: string,
    @Body() updateSkuDto: UpdateSkuDto,
  ): Promise<SkuResponseDto> {
    return this.inventoryService.updateSku(id, updateSkuDto);
  }

  @Delete('/skus/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'SKU 삭제' })
  @ApiParam({ name: 'id', description: 'SKU ID' })
  @ApiResponse({ status: 204, description: 'SKU가 성공적으로 삭제되었습니다.' })
  @ApiResponse({ status: 404, description: 'SKU를 찾을 수 없습니다.' })
  @ApiResponse({
    status: 409,
    description:
      '재고가 있거나 상품 매칭에 사용 중인 SKU는 삭제할 수 없습니다.',
  })
  async deleteSku(@Param('id') id: string): Promise<void> {
    return this.inventoryService.deleteSku(id);
  }

  @Post('/skus/:id/barcodes')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'SKU에 바코드 추가' })
  @ApiParam({ name: 'id', description: 'SKU ID' })
  @ApiResponse({
    status: 204,
    description: '바코드가 성공적으로 추가되었습니다.',
  })
  @ApiResponse({ status: 404, description: 'SKU를 찾을 수 없습니다.' })
  @ApiResponse({ status: 409, description: '이미 존재하는 바코드입니다.' })
  async addBarcode(
    @Param('id') id: string,
    @Body() addBarcodeDto: AddBarcodeDto,
  ): Promise<void> {
    return this.inventoryService.addBarcode(id, addBarcodeDto);
  }

  @Delete('/skus/:id/barcodes/:barcodeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'SKU에서 바코드 제거' })
  @ApiParam({ name: 'id', description: 'SKU ID' })
  @ApiParam({ name: 'barcodeId', description: '바코드 ID' })
  @ApiResponse({
    status: 204,
    description: '바코드가 성공적으로 제거되었습니다.',
  })
  @ApiResponse({
    status: 400,
    description: '기본 바코드는 제거할 수 없습니다.',
  })
  @ApiResponse({
    status: 404,
    description: 'SKU 또는 바코드를 찾을 수 없습니다.',
  })
  async removeBarcode(
    @Param('id') id: string,
    @Param('barcodeId') barcodeId: string,
  ): Promise<void> {
    return this.inventoryService.removeBarcode(id, barcodeId);
  }

  @Get('/skus/:id/stock-summary')
  @ApiOperation({ summary: 'SKU 재고 요약 조회' })
  @ApiParam({ name: 'id', description: 'SKU ID' })
  @ApiResponse({
    status: 200,
    description: 'SKU 재고 요약 정보',
    type: SkuStockSummaryDto,
  })
  @ApiResponse({ status: 404, description: 'SKU를 찾을 수 없습니다.' })
  async getSkuStockSummary(
    @Param('id') id: string,
  ): Promise<SkuStockSummaryDto> {
    return this.inventoryService.getSkuStockSummary(id);
  }

  // ═══════════════════════════════════════════════════════════════
  // 창고 관리 API
  // ═══════════════════════════════════════════════════════════════

  @Post('/warehouses')
  @ApiOperation({ summary: '새 창고 생성' })
  @ApiResponse({ status: 201, description: '창고가 생성되었습니다.' })
  async createWarehouse(@Body() createWarehouseDto: CreateWarehouseDto) {
    return this.inventoryService.createWarehouse(createWarehouseDto);
  }

  @Get('/warehouses')
  @ApiOperation({ summary: '모든 창고 목록 조회' })
  @ApiResponse({ status: 200, description: '창고 목록을 반환합니다.' })
  async findAllWarehouses() {
    return this.inventoryService.findAllWarehouses();
  }

  @Get('/warehouses/:id')
  @ApiOperation({ summary: '특정 창고 조회' })
  @ApiResponse({ status: 200, description: '창고 정보를 반환합니다.' })
  @ApiResponse({ status: 404, description: '창고를 찾을 수 없습니다.' })
  async findOneWarehouse(@Param('id') id: string) {
    return this.inventoryService.findOneWarehouse(id);
  }

  @Get('/warehouses/:id/summary')
  @ApiOperation({ summary: '창고별 재고 요약 조회' })
  @ApiResponse({ status: 200, description: '창고별 재고 요약을 반환합니다.' })
  async getWarehouseStockSummary(@Param('id') id: string) {
    return this.inventoryService.getWarehouseStockSummary(id);
  }

  @Patch('/warehouses/:id')
  @ApiOperation({ summary: '창고 정보 수정' })
  @ApiResponse({ status: 200, description: '창고 정보가 수정되었습니다.' })
  @ApiResponse({ status: 404, description: '창고를 찾을 수 없습니다.' })
  async updateWarehouse(
    @Param('id') id: string,
    @Body() updateWarehouseDto: UpdateWarehouseDto,
  ) {
    return this.inventoryService.updateWarehouse(id, updateWarehouseDto);
  }

  @Delete('/warehouses/:id')
  @ApiOperation({ summary: '창고 삭제' })
  @ApiResponse({ status: 200, description: '창고가 삭제되었습니다.' })
  @ApiResponse({ status: 404, description: '창고를 찾을 수 없습니다.' })
  @ApiResponse({
    status: 400,
    description: '기본 창고이거나 사용 중인 창고는 삭제할 수 없습니다.',
  })
  async removeWarehouse(@Param('id') id: string) {
    return this.inventoryService.removeWarehouse(id);
  }

  // ═══════════════════════════════════════════════════════════════
  // 안전 재고 관리 API
  // ═══════════════════════════════════════════════════════════════

  @Get('/safety-stock-warnings')
  @ApiOperation({
    summary: '안전 재고 미만 상품 조회 (Get items below safety stock)',
  })
  @ApiQuery({
    name: 'warehouseId',
    required: false,
    description: '창고 ID로 필터링',
  })
  @ApiResponse({
    status: 200,
    description: 'List of SKUs below safety stock',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          skuId: { type: 'string', description: 'SKU ID' },
          skuName: { type: 'string', description: 'SKU 이름' },
          skuCode: { type: 'string', description: 'SKU 코드' },
          currentStock: { type: 'number', description: '현재 재고' },
          safetyStock: { type: 'number', description: '안전 재고' },
          shortfall: { type: 'number', description: '부족량' },
          warehouseId: { type: 'string', description: '창고 ID' },
        },
      },
    },
  })
  async getSafetyStockWarnings(@Query('warehouseId') warehouseId?: string) {
    return this.safetyStockService.getBelowSafetyStock(warehouseId);
  }

  @Get('/safety-stock-status/:skuId')
  @ApiOperation({ summary: 'SKU의 안전 재고 상태 조회 (전체 창고)' })
  @ApiParam({ name: 'skuId', description: 'SKU ID' })
  @ApiResponse({
    status: 200,
    description: 'Safety stock status for SKU across all warehouses',
    schema: {
      type: 'object',
      properties: {
        skuId: { type: 'string' },
        skuName: { type: 'string' },
        skuCode: { type: 'string' },
        safetyStock: { type: 'number' },
        warehouses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              warehouseId: { type: 'string' },
              warehouseName: { type: 'string' },
              currentStock: { type: 'number' },
              isBelowSafety: { type: 'boolean' },
              shortfall: { type: 'number' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'SKU not found' })
  async getSafetyStockStatus(@Param('skuId') skuId: string) {
    const status = await this.safetyStockService.getSafetyStockStatus(skuId);
    if (!status) {
      throw new Error(`SKU with ID ${skuId} not found`);
    }
    return status;
  }
}
