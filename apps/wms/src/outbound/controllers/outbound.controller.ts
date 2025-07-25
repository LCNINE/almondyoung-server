import { Controller, Post, Get, Put, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { OutboundService } from '../services/outbound.service';
import { ProcessOutboundDto } from '../dto/outbound/process-outbound.dto';

@ApiTags('Outbound')
@Controller('wms/outbound')
export class OutboundController {
    constructor(private readonly outboundService: OutboundService) { }

    @Post(':stockId/process')
    @ApiOperation({ summary: '출고 처리' })
    @ApiResponse({ status: 200, description: '출고가 성공적으로 처리되었습니다.' })
    async processOutbound(
        @Param('stockId') stockId: string,
        @Body() outboundDto: ProcessOutboundDto
    ) {
        return this.outboundService.processOutbound(
            stockId,
            outboundDto.quantity,
            outboundDto.reason,
            outboundDto.orderId
        );
    }

    @Post('tasks/from-orders')
    @ApiOperation({ summary: '주문으로부터 출고 작업 생성' })
    @ApiResponse({ status: 201, description: '출고 작업이 성공적으로 생성되었습니다.' })
    async createOutboundTaskFromOrders(@Body() dto: { orderIds: string[] }) {
        return this.outboundService.createOutboundTaskFromOrders(dto.orderIds);
    }

    @Get('tasks/:taskId/picking-list')
    @ApiOperation({ summary: '피킹 리스트 생성' })
    @ApiResponse({ status: 200, description: '피킹 리스트가 성공적으로 생성되었습니다.' })
    async generatePickingList(@Param('taskId') taskId: string) {
        return this.outboundService.generatePickingList(taskId);
    }

    @Put('tasks/:taskId/status')
    @ApiOperation({ summary: '출고 작업 상태 업데이트' })
    @ApiResponse({ status: 200, description: '출고 작업 상태가 성공적으로 업데이트되었습니다.' })
    async updateTaskStatus(
        @Param('taskId') taskId: string,
        @Body() dto: { status: 'picking' | 'packed' | 'shipped' | 'canceled' }
    ) {
        return this.outboundService.updateTaskStatus(taskId, dto.status);
    }

    @Get('statistics')
    @ApiOperation({ summary: '출고 실적 조회' })
    @ApiQuery({ name: 'warehouseId', required: false, description: '창고 ID' })
    @ApiQuery({ name: 'days', required: false, description: '조회 기간 (일)', example: 30 })
    @ApiResponse({ status: 200, description: '출고 실적이 성공적으로 조회되었습니다.' })
    async getOutboundStatistics(
        @Query('warehouseId') warehouseId?: string,
        @Query('days') days?: string
    ) {
        return this.outboundService.getOutboundStatistics(
            warehouseId,
            days ? parseInt(days, 10) : 30
        );
    }
}
