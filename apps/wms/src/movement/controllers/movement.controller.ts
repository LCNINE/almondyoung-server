import { Controller, Post, Body, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { MovementService } from '../services/movement.service';
import { MoveBatchDto } from '../dto/move-batch.dto';
import { MovementJobWithLinesDto, MovementHistoryResponseDto } from '../dto/movement-response.dto';
import { MovementJobMapper, MovementJobLineMapper, MovementWorkLogMapper } from '../mappers/movement.mapper';

@ApiTags('Movement')
@Controller('movement')
export class MovementController {
  constructor(private readonly movementService: MovementService) {}

  @Post('move')
  @ApiOperation({ summary: '동일 창고 내 즉시 이동(배치)' })
  @ApiResponse({
    status: 200,
    description: '이동 작업이 성공적으로 처리되었습니다.',
    type: MovementJobWithLinesDto,
  })
  async moveImmediately(@Body() dto: MoveBatchDto): Promise<MovementJobWithLinesDto> {
    const result = await this.movementService.moveImmediately(dto);
    return MovementJobMapper.toWithLinesDto(result.job, result.lines);
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: '이동 작업 상세 조회' })
  @ApiResponse({
    status: 200,
    description: '작업 상세를 반환합니다.',
    type: MovementJobWithLinesDto,
  })
  async getJob(@Param('jobId') jobId: string): Promise<MovementJobWithLinesDto> {
    const { job, lines } = await this.movementService.getJobById(jobId);
    return MovementJobMapper.toWithLinesDto(job, lines);
  }

  @Get('history')
  @ApiOperation({ summary: '이동 작업 히스토리 조회' })
  @ApiQuery({ name: 'skuId', required: false })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'days', required: false, example: 7 })
  @ApiResponse({
    status: 200,
    description: '히스토리를 반환합니다.',
    type: MovementHistoryResponseDto,
  })
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
