import { Body, Controller, Delete, HttpCode, HttpStatus, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@app/authorization';
import { ReleaseReservationDto } from '../../inventory/core/dto/reservation/reserve-stock.dto';
import { ReservationReleaseService } from '../services/reservation-release.service';

@ApiTags('Inventory - Reservations')
@Controller('inventory/reservations')
export class ReservationReleaseController {
  constructor(private readonly service: ReservationReleaseService) {}

  /**
   * 예약 해제
   */
  @RequirePermission('inventory.stock.adjust')
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
  @ApiResponse({ status: 204, description: '예약 해제 성공' })
  @ApiResponse({ status: 400, description: '예약 ID 형식이 올바르지 않음' })
  @ApiResponse({ status: 404, description: '예약을 찾을 수 없음' })
  @ApiResponse({ status: 409, description: '해제할 수 없는 상태(이미 처리된 상자 등)' })
  @ApiResponse({ status: 403, description: '재고 원장 조정 권한이 없습니다.' })
  release(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReleaseReservationDto): Promise<void> {
    return this.service.release(id, dto?.reason);
  }
}
