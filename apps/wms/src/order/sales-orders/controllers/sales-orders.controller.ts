import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { SalesOrdersService } from '../services/sales-orders.service';
import { CreateSalesOrderDto } from '../dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from '../dto/update-sales-order.dto';
import { MergeSalesOrdersDto } from '../dto/merge-sales-orders.dto';
import { SalesOrderResponseDto } from '../dto/sales-order-response.dto';

@ApiTags('Sales Orders')
@Controller('sales-orders')
export class SalesOrdersController {
  constructor(private readonly service: SalesOrdersService) { }

  @Post()
  @ApiOperation({ summary: '판매 주문 생성', description: '새로운 판매 주문을 생성합니다.' })
  @ApiResponse({ status: 201, description: '판매 주문 생성 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  create(@Body() dto: CreateSalesOrderDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '판매 주문 수정', description: '기존 판매 주문 정보를 수정합니다.' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  @ApiResponse({ status: 200, description: '판매 주문 수정 성공' })
  @ApiResponse({ status: 404, description: '판매 주문을 찾을 수 없음' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  update(@Param('id') id: string, @Body() dto: UpdateSalesOrderDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/confirm')
  confirm(@Param('id') id: string) {
    return this.service.confirm(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }

  @Post('merge')
  @ApiOperation({ summary: '판매 주문 병합', description: '여러 판매 주문을 하나로 병합합니다.' })
  @ApiResponse({ status: 201, description: '판매 주문 병합 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '주문을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  merge(@Body() dto: MergeSalesOrdersDto) {
    return this.service.merge(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '판매 주문 조회', description: 'ID로 판매 주문을 조회합니다. 주문 라인 정보가 포함됩니다.' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  @ApiResponse({ status: 200, description: '판매 주문 조회 성공', type: SalesOrderResponseDto })
  @ApiResponse({ status: 404, description: '판매 주문을 찾을 수 없음' })
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }

  @Get()
  @ApiOperation({ summary: '판매 주문 목록 조회', description: '판매 주문 목록을 조회합니다. 각 주문의 라인 정보가 포함됩니다.' })
  @ApiQuery({ name: 'limit', required: false, description: '조회할 최대 개수', example: 20 })
  @ApiQuery({ name: 'offset', required: false, description: '건너뛸 개수', example: 0 })
  @ApiResponse({ status: 200, description: '판매 주문 목록 조회 성공', type: [SalesOrderResponseDto] })
  list(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.service.list({ limit: limit ? parseInt(limit, 10) : 20, offset: offset ? parseInt(offset, 10) : 0 });
  }
}


