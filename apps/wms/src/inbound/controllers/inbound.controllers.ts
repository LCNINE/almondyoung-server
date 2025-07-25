import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { InboundService } from '../services/inbound.service';
import { CreateInboundDto } from '../dto/create-inbound.dto';
import { CreateStockEntryDto } from '../dto/create-stock-entry.dto';

@ApiTags('Inbound')
@Controller('wms/inbound')
export class InboundController {
    constructor(private readonly inboundService: InboundService) { }

    @Post()
    @ApiOperation({ summary: '거래처로부터의 입고 처리 (국내/해외)' })
    @ApiResponse({ status: 201, description: '입고가 성공적으로 처리되었습니다.' })
    async processInbound(@Body() inboundDto: CreateInboundDto) {
        return this.inboundService.processInbound(inboundDto);
    }

    @Post('entry')
    @ApiOperation({ summary: '새로운 재고 묶음 생성 (판매등록 시 재고 0, 또는 수동 입고)' })
    @ApiResponse({ status: 201, description: '새로운 재고 묶음이 성공적으로 생성되었습니다.' })
    @ApiResponse({ status: 400, description: '잘못된 요청 또는 유효성 검사 실패.' })
    @ApiResponse({ status: 404, description: '관련 Product Matching 항목을 찾을 수 없음.' })
    async createStockEntry(@Body() createStockEntryDto: CreateStockEntryDto) {
        return this.inboundService.createStockEntry(createStockEntryDto);
    }

    @Get('pending')
    @ApiOperation({ summary: '입고 예정 목록 조회' })
    @ApiQuery({ name: 'warehouseId', required: false, description: '창고 ID' })
    @ApiResponse({ status: 200, description: '입고 예정 목록이 성공적으로 조회되었습니다.' })
    async getInboundPending(@Query('warehouseId') warehouseId?: string) {
        return this.inboundService.getInboundPending(warehouseId);
    }

    @Get('history')
    @ApiOperation({ summary: '입고 실적 조회' })
    @ApiQuery({ name: 'skuId', required: false, description: 'SKU ID' })
    @ApiQuery({ name: 'warehouseId', required: false, description: '창고 ID' })
    @ApiQuery({ name: 'days', required: false, description: '조회 기간 (일)', example: 30 })
    @ApiResponse({ status: 200, description: '입고 실적이 성공적으로 조회되었습니다.' })
    async getInboundHistory(
        @Query('skuId') skuId?: string,
        @Query('warehouseId') warehouseId?: string,
        @Query('days') days?: string
    ) {
        return this.inboundService.getInboundHistory(
            skuId,
            warehouseId,
            days ? parseInt(days, 10) : 30
        );
    }

    @Post('verify-barcode')
    @ApiOperation({ summary: '입고 검수 - 바코드 스캔' })
    @ApiResponse({ status: 200, description: '바코드가 성공적으로 검증되었습니다.' })
    @ApiResponse({ status: 404, description: '바코드에 해당하는 SKU를 찾을 수 없습니다.' })
    @ApiResponse({ status: 400, description: '스캔한 SKU가 예상 SKU와 다릅니다.' })
    async verifyInboundByBarcode(@Body() dto: { barcode: string; expectedSkuId?: string }) {
        return this.inboundService.verifyInboundByBarcode(
            dto.barcode,
            dto.expectedSkuId
        );
    }
}