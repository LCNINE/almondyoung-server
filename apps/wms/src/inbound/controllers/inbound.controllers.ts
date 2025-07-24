import { Controller, Post, Body, Get, Query, Param } from '@nestjs/common';
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

    // TODO: 입고 리스트 조회 

    // TODO: 입고 바코드 스캔 
}