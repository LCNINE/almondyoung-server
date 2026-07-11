import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { UnifiedReservationService } from '../../shared/services/unified-reservation.service';
import { ReserveStockDto, ReleaseReservationDto } from '../dto/reservation/reserve-stock.dto';
import { ReservationDto, ReservationSummaryDto } from '../dto/reservation/reservation-response.dto';

@ApiTags('Inventory - Reservations')
@Controller('inventory/reservations')
export class ReservationController {
  constructor(private readonly unifiedReservation: UnifiedReservationService) {}

  /**
   * 재고 예약 생성
   */
  @Post()
  @ApiOperation({
    summary: '재고 예약 생성',
    description: '주문(FO) 또는 이동 작업(Movement Task)에 대한 재고 예약을 생성합니다.',
  })
  @ApiResponse({
    status: 201,
    description: '예약 생성 성공',
    type: ReservationDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 (수량 부족 등)',
  })
  @ApiResponse({
    status: 409,
    description: '재고 부족',
  })
  async reserveStock(@Body() dto: ReserveStockDto): Promise<ReservationDto> {
    try {
      const reservation = await this.unifiedReservation.reserveStock({
        targetType: dto.targetType,
        targetId: dto.targetId,
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        quantity: dto.quantity,
        fulfillmentOrderItemId: dto.fulfillmentOrderItemId,
        timeoutAt: dto.timeoutAt ? new Date(dto.timeoutAt) : undefined,
        reason: dto.reason,
      });

      return reservation as ReservationDto;
    } catch (error) {
      if (error.message?.includes('Insufficient stock')) {
        throw new BadRequestException(error.message);
      }
      if (error.message?.includes('not found')) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  /**
   * 예약 해제
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '예약 해제',
    description: '특정 예약을 해제하여 재고를 다시 할당 가능하게 만듭니다.',
  })
  @ApiParam({
    name: 'id',
    description: '예약 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 204,
    description: '예약 해제 성공',
  })
  @ApiResponse({
    status: 404,
    description: '예약을 찾을 수 없음',
  })
  async releaseReservation(@Param('id') id: string, @Body() dto?: ReleaseReservationDto): Promise<void> {
    try {
      await this.unifiedReservation.releaseReservation(id);
    } catch (error) {
      if (error.message?.includes('not found')) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  /**
   * 특정 Target의 예약 조회
   */
  @Get('by-target')
  @ApiOperation({
    summary: 'Target별 예약 조회',
    description: 'FO 또는 Movement Task가 예약한 모든 SKU 정보를 조회합니다.',
  })
  @ApiQuery({
    name: 'targetType',
    description: '대상 타입',
    enum: ['FULFILLMENT_ORDER', 'MOVEMENT_TASK'],
    example: 'FULFILLMENT_ORDER',
  })
  @ApiQuery({
    name: 'targetId',
    description: '대상 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: '예약 목록',
    type: [ReservationDto],
  })
  async getReservationsByTarget(
    @Query('targetType') targetType: string,
    @Query('targetId') targetId: string,
  ): Promise<ReservationDto[]> {
    const reservations = await this.unifiedReservation.getReservationsByTarget(targetType, targetId);

    return reservations as ReservationDto[];
  }

  /**
   * 특정 SKU의 예약 조회
   */
  @Get('by-sku/:skuId')
  @ApiOperation({
    summary: 'SKU별 예약 조회',
    description: '특정 SKU가 어떤 FO/Task에 예약되어 있는지 조회합니다.',
  })
  @ApiParam({
    name: 'skuId',
    description: 'SKU ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @ApiQuery({
    name: 'warehouseId',
    description: '창고 ID (선택적)',
    required: false,
    example: '550e8400-e29b-41d4-a716-446655440002',
  })
  @ApiResponse({
    status: 200,
    description: '예약 목록',
    type: [ReservationDto],
  })
  async getReservationsBySku(
    @Param('skuId') skuId: string,
    @Query('warehouseId') warehouseId?: string,
  ): Promise<ReservationDto[]> {
    const reservations = await this.unifiedReservation.getReservationsBySku(skuId, warehouseId);

    return reservations as ReservationDto[];
  }

  /**
   * 창고별 예약 통계
   */
  @Get('summary/:warehouseId')
  @ApiOperation({
    summary: '창고별 예약 통계',
    description: '특정 창고의 SKU별 예약 현황을 조회합니다.',
  })
  @ApiParam({
    name: 'warehouseId',
    description: '창고 ID',
    example: '550e8400-e29b-41d4-a716-446655440002',
  })
  @ApiResponse({
    status: 200,
    description: '예약 통계',
    type: [ReservationSummaryDto],
  })
  async getReservationSummary(@Param('warehouseId') warehouseId: string): Promise<ReservationSummaryDto[]> {
    const summary = await this.unifiedReservation.getReservationSummary(warehouseId);

    return summary as ReservationSummaryDto[];
  }

  /**
   * 만료된 예약 처리 (관리자용)
   */
  @Post('expire-stale')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '만료된 예약 일괄 해제',
    description: 'timeoutAt이 지난 예약을 일괄 해제합니다 (관리자 또는 Cron Job 용도).',
  })
  @ApiResponse({
    status: 200,
    description: '해제된 예약 개수',
    schema: {
      type: 'object',
      properties: {
        releasedCount: { type: 'number', example: 5 },
        message: { type: 'string', example: 'Released 5 expired reservations' },
      },
    },
  })
  async expireStaleReservations(): Promise<{ releasedCount: number; message: string }> {
    const releasedCount = await this.unifiedReservation.releaseExpiredReservations();

    return {
      releasedCount,
      message: `Released ${releasedCount} expired reservations`,
    };
  }
}
