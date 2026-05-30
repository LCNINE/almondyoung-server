import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { SalesOrdersService } from '../services/sales-orders.service';
import { CreateSalesOrderDto } from '../dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from '../dto/update-sales-order.dto';
import { MergeSalesOrdersDto } from '../dto/merge-sales-orders.dto';
import { SalesOrderResponseDto } from '../dto/sales-order-response.dto';
import { SalesOrderFilterDto } from '../dto/sales-order-filter.dto';
import { CreateBusinessLinkDto } from '../dto/create-business-link.dto';

@ApiTags('Sales Orders')
@Controller('sales-orders')
export class SalesOrdersController {
  constructor(private readonly service: SalesOrdersService) {}

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
  @ApiOperation({ summary: '판매 주문 취소' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }

  @Post(':id/business-links')
  @ApiOperation({ summary: '판매 주문 업무 연결 생성' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  @ApiResponse({ status: 201, description: '업무 연결 생성 성공' })
  createBusinessLink(@Param('id') id: string, @Body() dto: CreateBusinessLinkDto) {
    return this.service.createBusinessLink(id, dto);
  }

  @Post('merge')
  @ApiOperation({ summary: '판매 주문 병합', description: '여러 판매 주문을 하나로 병합합니다.' })
  @ApiResponse({ status: 201, description: '판매 주문 병합 성공' })
  merge(@Body() dto: MergeSalesOrdersDto) {
    return this.service.merge(dto);
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
