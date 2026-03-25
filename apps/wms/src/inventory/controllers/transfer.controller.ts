import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { TransferService } from '../services/transfer.service';
import { MovementJob } from '../../../database/schemas/wms-schema';
import {
  CreateTransferJobDto,
  ExecuteTransferJobDto,
  MoveWithinWarehouseDto,
} from '../dto/transfer/create-transfer.dto';
import {
  TransferJobWithLinesDto,
  CreateTransferJobResponseDto,
  ExecuteTransferJobResponseDto,
  MoveWithinWarehouseResponseDto,
  TransferJobStatusDto,
  TransferJobListResponseDto,
} from '../dto/transfer/transfer-response.dto';
import { TransferJobMapper, TransferJobLineMapper } from '../mappers/transfer.mapper';

@ApiTags('Inventory - Transfers')
@Controller('inventory/transfers')
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  /**
   * 1. 창고 간/창고 내 이동 작업 생성
   */
  @Post()
  @ApiOperation({
    summary: '이동 작업 생성',
    description: '창고 간 또는 창고 내 재고 이동 작업을 계획합니다. 실행은 별도로 수행합니다.',
  })
  @ApiResponse({
    status: 201,
    description: '이동 작업 생성 성공',
    type: CreateTransferJobResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 (아이템 없음 등)',
  })
  async createTransferJob(@Body() dto: CreateTransferJobDto): Promise<CreateTransferJobResponseDto> {
    try {
      const result = await this.transferService.createTransferJob({
        fromWarehouseId: dto.fromWarehouseId,
        toWarehouseId: dto.toWarehouseId,
        items: dto.items,
        actorId: dto.actorId,
        memo: dto.memo,
      });

      return {
        jobId: result.jobId,
        journalId: result.journalId,
        lines: result.lines.map((line) => TransferJobLineMapper.toDto(line)),
      };
    } catch (error) {
      if (error.message?.includes('required') || error.message?.includes('At least')) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /**
   * 2. 이동 작업 실행
   */
  @Patch(':id/execute')
  @ApiOperation({
    summary: '이동 작업 실행',
    description: '생성된 이동 작업을 실행하여 실제 재고 이동을 수행합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '이동 작업 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: '이동 작업 실행 성공',
    type: ExecuteTransferJobResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '이동 작업을 찾을 수 없음',
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 작업 (아이템 없음, 잘못된 위치 등)',
  })
  async executeTransferJob(@Param('id') id: string): Promise<ExecuteTransferJobResponseDto> {
    try {
      return await this.transferService.executeTransferJob({ jobId: id });
    } catch (error) {
      if (error.message?.includes('not found')) {
        throw new NotFoundException(error.message);
      }
      if (
        error.message?.includes('No items') ||
        error.message?.includes('Invalid') ||
        error.message?.includes('Insufficient')
      ) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /**
   * 3. 창고 내 간편 이동
   */
  @Post('move-within-warehouse')
  @ApiOperation({
    summary: '창고 내 간편 이동',
    description: '단일 SKU를 창고 내에서 다른 위치로 즉시 이동합니다.',
  })
  @ApiResponse({
    status: 201,
    description: '이동 성공',
    type: MoveWithinWarehouseResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청',
  })
  async moveWithinWarehouse(@Body() dto: MoveWithinWarehouseDto): Promise<MoveWithinWarehouseResponseDto> {
    try {
      return await this.transferService.moveWithinWarehouse({
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        fromLocationId: dto.fromLocationId,
        toLocationId: dto.toLocationId,
        quantity: dto.quantity,
        actorId: dto.actorId,
        memo: dto.memo,
      });
    } catch (error) {
      if (error.message?.includes('Insufficient') || error.message?.includes('Invalid')) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /**
   * 4. 이동 작업 상세 조회
   */
  @Get(':id')
  @ApiOperation({
    summary: '이동 작업 상세 조회',
    description: '특정 이동 작업의 상세 정보와 라인 목록을 조회합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '이동 작업 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: '이동 작업 상세 정보',
    type: TransferJobWithLinesDto,
  })
  @ApiResponse({
    status: 404,
    description: '이동 작업을 찾을 수 없음',
  })
  async getTransferJob(@Param('id') id: string): Promise<TransferJobWithLinesDto> {
    try {
      const { lines, ...job } = await this.transferService.getTransferJob(id);
      return TransferJobMapper.toWithLinesDto(job, lines);
    } catch (error) {
      if (error.message?.includes('not found')) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  /**
   * 5. 이동 작업 상태 조회
   */
  @Get(':id/status')
  @ApiOperation({
    summary: '이동 작업 상태 조회',
    description: '이동 작업의 실행 상태를 조회합니다 (pending/in_progress/completed).',
  })
  @ApiParam({
    name: 'id',
    description: '이동 작업 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: '이동 작업 상태',
    type: TransferJobStatusDto,
  })
  @ApiResponse({
    status: 404,
    description: '이동 작업을 찾을 수 없음',
  })
  async getTransferJobStatus(@Param('id') id: string): Promise<TransferJobStatusDto> {
    try {
      return await this.transferService.getTransferJobStatus(id);
    } catch (error) {
      if (error.message?.includes('not found')) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  /**
   * 6. 이동 작업 목록 조회
   */
  @Get()
  @ApiOperation({
    summary: '이동 작업 목록 조회',
    description: '이동 작업 목록을 필터링 및 페이징하여 조회합니다.',
  })
  @ApiQuery({
    name: 'warehouseId',
    description: '창고 ID (선택적)',
    required: false,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiQuery({
    name: 'limit',
    description: '페이지 크기',
    required: false,
    example: 50,
  })
  @ApiQuery({
    name: 'offset',
    description: '오프셋',
    required: false,
    example: 0,
  })
  @ApiResponse({
    status: 200,
    description: '이동 작업 목록',
    type: TransferJobListResponseDto,
  })
  async listTransferJobs(
    @Query('warehouseId') warehouseId?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<TransferJobListResponseDto> {
    const parsedLimit = limit ?? 50;
    const parsedOffset = offset ?? 0;

    const jobs = await this.transferService.listTransferJobs({
      warehouseId,
      limit: parsedLimit,
      offset: parsedOffset,
    });

    return {
      jobs: jobs.map((job) => TransferJobMapper.toWithLineCountDto(job, job.lineCount)),
      total: jobs.length,
      limit: parsedLimit,
      offset: parsedOffset,
    };
  }
}
