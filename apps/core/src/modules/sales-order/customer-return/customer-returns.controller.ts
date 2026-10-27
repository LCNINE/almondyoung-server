import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission, RequireScopes, ScopeGuard, User } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../platform/auth/inventory-scopes';
import {
  WarehouseActor,
  authenticatedWarehouseActor,
} from '../../inventory/core/services/warehouse-operation-contract';
import { CustomerReturnService } from './customer-return.service';
import { RecordCustomerReturnArrivalDto, RecordCustomerReturnInspectionDto } from './dto/customer-return-receiving.dto';

/**
 * 고객 반품 기록(K8 PR6) — 조회와 창고의 도착·검수. 응답에 고객 개인정보는 없다(반품·줄·SKU 항목의 수량과 상태뿐).
 */
@ApiTags('Admin - Customer Returns')
@Controller('admin/customer-returns')
export class CustomerReturnsController {
  constructor(private readonly service: CustomerReturnService) {}

  @RequirePermission('order.claim.read')
  @Get(':id')
  @ApiOperation({ summary: '반품 기록 조회 — 줄·SKU 항목별 기대·도착·검수 수량과 정산 진행' })
  @ApiParam({ name: 'id', description: '반품 기록 id(customer_returns.id)' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }

  @RequirePermission('inventory.stock.operate')
  @Post(':id/arrivals')
  @UseGuards(ScopeGuard)
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '반품 도착 — 받은 수량을 원장 RETURNED 로. 소포마다 멱등키 필수' })
  @ApiResponse({ status: 200, description: '도착 반영 뒤의 반품 기록' })
  @ApiResponse({
    status: 400,
    description: '배송완료하지 않은 창고 · 첫 도착과 다른 창고 · 남의 항목 · 기대 수량 초과',
  })
  @ApiResponse({ status: 409, description: '도착을 받을 수 없는 상태 · 같은 키로 다른 수량' })
  @HttpCode(HttpStatus.OK)
  recordArrival(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordCustomerReturnArrivalDto,
    @User() user?: WarehouseActor,
  ) {
    return this.service.recordArrival({
      customerReturnId: id,
      warehouseId: dto.warehouseId,
      items: dto.items,
      idempotencyKey: dto.idempotencyKey,
      actorId: authenticatedWarehouseActor(user),
    });
  }

  @RequirePermission('inventory.stock.operate')
  @Post(':id/inspection')
  @UseGuards(ScopeGuard)
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '반품 검수 — 양품·불량·보류. 보류가 없으면 채널에 수령·환불 정산을 요청한다' })
  @ApiResponse({ status: 200, description: '검수 반영 뒤의 반품 기록' })
  @ApiResponse({ status: 400, description: '아직 도착하지 않은 수량 · 항목 누락·중복 · 합이 도착 수량과 다름' })
  @ApiResponse({ status: 409, description: '검수할 수 없는 상태 · 이미 다른 결과로 검수함' })
  @HttpCode(HttpStatus.OK)
  recordInspection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordCustomerReturnInspectionDto,
    @User() user?: WarehouseActor,
  ) {
    return this.service.recordInspection({
      customerReturnId: id,
      items: dto.items,
      actorId: authenticatedWarehouseActor(user),
    });
  }
}
