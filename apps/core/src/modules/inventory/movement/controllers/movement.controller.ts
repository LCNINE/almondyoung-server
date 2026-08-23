import { Controller, Post, Body, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { MovementService } from '../services/movement.service';
import { MoveBatchDto } from '../dto/move-batch.dto';
import { MovementJobWithLinesDto, MovementHistoryResponseDto } from '../dto/movement-response.dto';
import { MovementJobMapper, MovementWorkLogMapper } from '../mappers/movement.mapper';

@ApiTags('Movement')
@Controller('movement')
@UseGuards(ScopeGuard)
export class MovementController {
  constructor(private readonly movementService: MovementService) {}

  @Post('move')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '동일 창고 내 즉시 이동(배치)' })
  @ApiResponse({
    status: 200,
    description: '이동 작업이 성공적으로 처리되었습니다.',
    type: MovementJobWithLinesDto,
  })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async moveImmediately(@Body() dto: MoveBatchDto): Promise<MovementJobWithLinesDto> {
    const result = await this.movementService.moveImmediately(dto);
    return MovementJobMapper.toWithLinesDto(result.job, result.lines);
  }

  @Get('jobs/:jobId')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '이동 작업 상세 조회' })
  @ApiResponse({
    status: 200,
    description: '작업 상세를 반환합니다.',
    type: MovementJobWithLinesDto,
  })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async getJob(@Param('jobId') jobId: string): Promise<MovementJobWithLinesDto> {
    const { job, lines } = await this.movementService.getJobById(jobId);
    return MovementJobMapper.toWithLinesDto(job, lines);
  }

  @Get('history')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '이동 작업 히스토리 조회' })
  @ApiQuery({ name: 'skuId', required: false })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'days', required: false, example: 7 })
  @ApiResponse({
    status: 200,
    description: '히스토리를 반환합니다.',
    type: MovementHistoryResponseDto,
  })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async history(
    @Query('skuId') skuId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('days') days?: string,
  ): Promise<MovementHistoryResponseDto> {
    const parsedDays = days ? parseInt(days, 10) : 7;
    const logs = await this.movementService.getMovementHistory({
      skuId,
      warehouseId,
      days: parsedDays,
    });

    return {
      logs: logs.map((log) => MovementWorkLogMapper.toDto(log)),
      days: parsedDays,
      total: logs.length,
    };
  }
}
