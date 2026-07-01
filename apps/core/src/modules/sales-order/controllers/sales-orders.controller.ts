import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { SalesOrdersService } from '../services/sales-orders.service';
import { SalesOrderAmendmentsService } from '../services/sales-order-amendments.service';
import { StoreSalesOrdersService } from '../services/store-sales-orders.service';
import { CreateSalesOrderDto } from '../dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from '../dto/update-sales-order.dto';
import { SalesOrderResponseDto } from '../dto/sales-order-response.dto';
import { SalesOrderFilterDto } from '../dto/sales-order-filter.dto';
import { CreateBusinessLinkDto } from '../dto/create-business-link.dto';
import { CancelSalesOrderDto } from '../dto/cancel-sales-order.dto';

@ApiTags('Sales Orders')
@Controller('sales-orders')
export class SalesOrdersController {
  constructor(
    private readonly service: SalesOrdersService,
    private readonly amendments: SalesOrderAmendmentsService,
    private readonly storeSalesOrders: StoreSalesOrdersService,
  ) {}

  @Post()
  @ApiOperation({ summary: '판매 주문 생성' })
  @ApiResponse({ status: 201, description: '판매 주문 생성 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  create(@Body() dto: CreateSalesOrderDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '판매 주문 수정' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  @ApiResponse({ status: 200, description: '판매 주문 수정 성공' })
  update(@Param('id') id: string, @Body() dto: UpdateSalesOrderDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/confirm')
  @ApiOperation({ summary: '판매 주문 확정' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  confirm(@Param('id') id: string) {
    return this.service.confirm(id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: '판매 주문 취소 (관리자 경로 — Wallet 환불 포함)' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  @ApiResponse({ status: 200, description: '취소 성공. { status, refundStatus } 반환' })
  cancel(@Param('id') id: string, @Body() dto: CancelSalesOrderDto = {}) {
    return this.storeSalesOrders.adminCancelRequest(id, {
      reasonCode: dto.reasonCode,
      reasonDetail: dto.reasonDetail,
      lines: dto.lines,
    });
  }

  @Post(':id/business-links')
  @ApiOperation({ summary: '판매 주문 업무 연결 생성' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  @ApiResponse({ status: 201, description: '업무 연결 생성 성공' })
  createBusinessLink(@Param('id') id: string, @Body() dto: CreateBusinessLinkDto) {
    return this.service.createBusinessLink(id, dto);
  }

  @Get(':id/amendments')
  @ApiOperation({ summary: '판매 주문 정정 목록 조회' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  listAmendments(@Param('id') id: string) {
    return this.amendments.listForSalesOrder(id);
  }

  @Get('stats')
  @ApiOperation({ summary: '주문 현황 통계', description: '최근 14일 주문 현황 통계를 조회합니다.' })
  getStats() {
    return this.service.getStats();
  }

  @Get(':id')
  @ApiOperation({ summary: '판매 주문 단건 조회' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  @ApiResponse({ status: 200, description: '조회 성공', type: SalesOrderResponseDto })
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }

  @Get()
  @ApiOperation({ summary: '판매 주문 목록 조회' })
  @ApiResponse({ status: 200, description: '목록 조회 성공', type: [SalesOrderResponseDto] })
  list(@Query() query: SalesOrderFilterDto) {
    return this.service.list(query);
  }
}
