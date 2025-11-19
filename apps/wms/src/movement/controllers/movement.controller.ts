import { Controller, Post, Body, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { MovementService } from '../services/movement.service';
import { MoveBatchDto } from '../dto/move-batch.dto';

@ApiTags('Movement')
@Controller('movement')
export class MovementController {
    constructor(private readonly movementService: MovementService) { }

    @Post('move')
    @ApiOperation({ summary: '동일 창고 내 즉시 이동(배치)' })
    @ApiResponse({ status: 200, description: '이동 작업이 성공적으로 처리되었습니다.' })
    async moveImmediately(@Body() dto: MoveBatchDto) {
        return this.movementService.moveImmediately(dto);
    }

    @Get('jobs/:jobId')
    @ApiOperation({ summary: '이동 작업 상세 조회' })
    @ApiResponse({ status: 200, description: '작업 상세를 반환합니다.' })
    async getJob(@Param('jobId') jobId: string) {
        return this.movementService.getJobById(jobId);
    }

    @Get('history')
    @ApiOperation({ summary: '이동 작업 히스토리 조회' })
    @ApiQuery({ name: 'skuId', required: false })
    @ApiQuery({ name: 'warehouseId', required: false })
    @ApiQuery({ name: 'days', required: false, example: 7 })
    @ApiResponse({ status: 200, description: '히스토리를 반환합니다.' })
    async history(
        @Query('skuId') skuId?: string,
        @Query('warehouseId') warehouseId?: string,
        @Query('days') days?: string,
    ) {
        return this.movementService.getMovementHistory({ skuId, warehouseId, days: days ? parseInt(days, 10) : undefined });
    }
}