import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { WarehouseTransferService } from '../services/warehouse-transfer.service';
import { CreateTransferOrderDto } from '../dto/create-transfer-order.dto';
import { ReceiveTransferDto } from '../dto/receive-transfer.dto';
import { ShipTransferOrderDto } from '../dto/ship-transfer-order.dto';
import { UpdateEtaDto } from '../dto/update-eta.dto';
import {
  CreateTransferOrderResponseDto,
  ShipTransferOrderResponseDto,
  ReceiveTransferResponseDto,
  OutstandingTransferListDto,
} from '../dto/transfer-order-response.dto';

/**
 * 이동 지시서 HTTP 표면. DB/도메인 로직은 전혀 없다 — 전부 Service(→Manager/Reader)
 * 로 위임한다. 에러를 상태코드로 매핑하는 try/catch 는 쓰지 않는다 —
 * GlobalExceptionFilter 가 @app/shared 도메인 예외를 상태코드로 변환한다.
 */
@ApiTags('Inventory - Warehouse Transfers')
@Controller('inventory/warehouse-transfers')
@UseGuards(ScopeGuard)
export class WarehouseTransferController {
  constructor(private readonly service: WarehouseTransferService) {}

  // outstanding 은 :id 보다 먼저 선언해야 한다 — Nest 는 선언 순서로 라우트를 매칭하므로
  // :id 가 먼저 오면 'outstanding' 이 id 파라미터로 흡수된다.
  @Get('outstanding')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '미도착 잔량 목록' })
  @ApiResponse({ status: 200, type: OutstandingTransferListDto })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async outstanding(): Promise<OutstandingTransferListDto> {
    const items = await this.service.findOutstanding();
    return { items };
  }

  @Post()
  @RequireScopes(INVENTORY_SCOPE.ADJUST)
  @ApiOperation({ summary: '이동 지시서 생성' })
  @ApiResponse({ status: 201, type: CreateTransferOrderResponseDto })
  @ApiResponse({ status: 403, description: '재고 원장 조정 권한이 없습니다.' })
  create(@Body() dto: CreateTransferOrderDto): Promise<CreateTransferOrderResponseDto> {
    return this.service.createOrder({
      fromWarehouseId: dto.fromWarehouseId,
      toWarehouseId: dto.toWarehouseId,
      eta: dto.eta ? new Date(dto.eta) : undefined,
      memo: dto.memo,
      actorId: dto.actorId,
      lines: dto.lines,
    });
  }

  @Post(':id/ship')
  @RequireScopes(INVENTORY_SCOPE.ADJUST)
  @ApiOperation({ summary: '선적 — 출발 창고 재고를 운송중으로' })
  @ApiResponse({ status: 201, type: ShipTransferOrderResponseDto })
  @ApiResponse({ status: 403, description: '재고 원장 조정 권한이 없습니다.' })
  ship(@Param('id') id: string, @Body() dto: ShipTransferOrderDto): Promise<ShipTransferOrderResponseDto> {
    return this.service.ship({ transferOrderId: id, idempotencyKey: dto.idempotencyKey, actorId: dto.actorId });
  }

  @Post(':id/receipts')
  @RequireScopes(INVENTORY_SCOPE.ADJUST)
  @ApiOperation({ summary: '도착 회차 등록 — 부분 도착과 분실을 함께 정산' })
  @ApiResponse({ status: 201, type: ReceiveTransferResponseDto })
  @ApiResponse({ status: 403, description: '재고 원장 조정 권한이 없습니다.' })
  receive(@Param('id') id: string, @Body() dto: ReceiveTransferDto): Promise<ReceiveTransferResponseDto> {
    return this.service.receive({
      transferOrderId: id,
      idempotencyKey: dto.idempotencyKey,
      toLocationId: dto.toLocationId,
      actorId: dto.actorId,
      lines: dto.lines,
    });
  }

  @Patch(':id/eta')
  @RequireScopes(INVENTORY_SCOPE.ADJUST)
  @ApiOperation({ summary: '도착 예정일 갱신 (선적 지연 등)' })
  @ApiResponse({ status: 403, description: '재고 원장 조정 권한이 없습니다.' })
  async updateEta(@Param('id') id: string, @Body() dto: UpdateEtaDto): Promise<void> {
    await this.service.updateEta({ transferOrderId: id, eta: new Date(dto.eta) });
  }
}
