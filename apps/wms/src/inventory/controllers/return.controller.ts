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
import { ReturnService } from '../services/return.service';
import { CreateReturnDto, ReceiveReturnDto, InspectReturnDto, ProcessReturnDto } from '../dto/return/create-return.dto';
import {
  ReturnDto,
  CreateReturnResponseDto,
  ReceiveReturnResponseDto,
  InspectReturnResponseDto,
  ProcessReturnResponseDto,
  ReturnListResponseDto,
} from '../dto/return/return-response.dto';
import { ReturnItemMapper, ReturnMapper } from '../mappers/return.mapper';
import { ReturnFiltersDto } from '../dto/return/return-filters.dto';
import { ReturnStatusEnum } from 'apps/wms/database/schemas/enum-values';
import { Return } from 'apps/wms/database/schemas/wms-schema';

@ApiTags('Inventory - Returns')
@Controller('inventory/returns')
export class ReturnController {
  constructor(private readonly returnService: ReturnService) {}

  /**
   * 1. 반품 요청 생성
   */
  @Post()
  @ApiOperation({
    summary: '반품 요청 생성',
    description: '고객 반품 요청을 생성합니다. 반품 아이템 목록과 사유를 포함합니다.',
  })
  @ApiResponse({
    status: 201,
    description: '반품 요청 생성 성공',
    type: CreateReturnResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청',
  })
  async createReturn(@Body() dto: CreateReturnDto): Promise<CreateReturnResponseDto> {
    try {
      const { returnId, items } = await this.returnService.createReturnRequest({
        orderId: dto.orderId,
        shipmentId: dto.shipmentId,
        warehouseId: dto.warehouseId,
        returnReason: dto.returnReason,
        items: dto.items,
      });
      return {
        returnId,
        items: items.map((item) => ReturnItemMapper.toDto(item)),
      };
    } catch (error) {
      if (error.message?.includes('required')) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /**
   * 2. 반품 상품 입고
   */
  @Patch(':id/receive')
  @ApiOperation({
    summary: '반품 상품 입고',
    description: '반품 요청된 상품을 물류센터에서 실제로 입고 처리합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '반품 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: '반품 입고 성공',
    type: ReceiveReturnResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '반품을 찾을 수 없음',
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 상태 또는 수량 초과',
  })
  async receiveReturn(@Param('id') id: string, @Body() dto: ReceiveReturnDto): Promise<ReceiveReturnResponseDto> {
    try {
      return await this.returnService.receiveReturn({
        returnId: id,
        items: dto.items,
      });
    } catch (error) {
      if (error.message?.includes('not found')) {
        throw new NotFoundException(error.message);
      }
      if (error.message?.includes('cannot be received') || error.message?.includes('exceeds')) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /**
   * 3. 품질 검사 (QC)
   */
  @Patch(':id/inspect')
  @ApiOperation({
    summary: '반품 품질 검사',
    description: '입고된 반품 상품에 대해 품질 검사를 수행합니다. 통과/실패 판정 및 사유를 기록합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '반품 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: '품질 검사 완료',
    type: InspectReturnResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '반품을 찾을 수 없음',
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 상태 또는 검사 수량 초과',
  })
  async inspectReturn(@Param('id') id: string, @Body() dto: InspectReturnDto): Promise<InspectReturnResponseDto> {
    try {
      return await this.returnService.inspectReturn({
        returnId: id,
        inspectedBy: dto.inspectedBy,
        items: dto.items,
        qcNotes: dto.qcNotes,
      });
    } catch (error) {
      if (error.message?.includes('not found')) {
        throw new NotFoundException(error.message);
      }
      if (error.message?.includes('cannot be inspected') || error.message?.includes('exceeds')) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /**
   * 4. 최종 처리 (재입고/폐기)
   */
  @Patch(':id/process')
  @ApiOperation({
    summary: '반품 최종 처리',
    description: 'QC 검사 완료된 반품을 재입고 또는 폐기 처리합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '반품 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: '반품 처리 완료',
    type: ProcessReturnResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '반품을 찾을 수 없음',
  })
  @ApiResponse({
    status: 400,
    description: 'QC 미완료 또는 잘못된 처리 요청',
  })
  async processReturn(@Param('id') id: string, @Body() dto: ProcessReturnDto): Promise<ProcessReturnResponseDto> {
    try {
      return await this.returnService.processReturn({
        returnId: id,
        items: dto.items,
      });
    } catch (error) {
      if (error.message?.includes('not found')) {
        throw new NotFoundException(error.message);
      }
      if (
        error.message?.includes('cannot be processed') ||
        error.message?.includes('required') ||
        error.message?.includes('no current location')
      ) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /**
   * 반품 상세 조회
   */
  @Get(':id')
  @ApiOperation({
    summary: '반품 상세 조회',
    description: '특정 반품의 상세 정보와 반품 아이템 목록을 조회합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '반품 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: '반품 상세 정보',
    type: ReturnDto,
  })
  @ApiResponse({
    status: 404,
    description: '반품을 찾을 수 없음',
  })
  async getReturn(@Param('id') id: string): Promise<ReturnDto> {
    const returnEntity = await this.returnService.getReturn(id);
    return ReturnMapper.toDto(returnEntity);
  }

  /**
   * 반품 목록 조회
   */
  @Get()
  @ApiOperation({
    summary: '반품 목록 조회',
    description: '반품 목록을 필터링 및 페이징하여 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '반품 목록',
    type: ReturnListResponseDto,
  })
  async listReturns(@Query() filters: ReturnFiltersDto): Promise<ReturnListResponseDto> {
    const returns: Return[] = await this.returnService.listReturns({
      warehouseId: filters.warehouseId,
      status: filters.status,
      orderId: filters.orderId,
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
    });

    return {
      returns: returns.map((returnEntity) => ReturnMapper.toDto(returnEntity)),
      total: returns.length,
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
    };
  }
}
