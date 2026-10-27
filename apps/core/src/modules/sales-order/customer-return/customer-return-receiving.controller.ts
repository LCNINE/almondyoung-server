import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { RequirePermission, RequireScopes, ScopeGuard } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../platform/auth/inventory-scopes';
import { CustomerReturnService } from './customer-return.service';
import { ListReceivingCustomerReturnsQueryDto } from './dto/list-receiving-customer-returns.dto';

/**
 * 창고의 반품 도착·검수 화면이 읽는 문(K8 PR7b N2). 도착·검수 쓰기(`admin/customer-returns/:id/…`)와 같은 권한·스코프다 —
 * 창고 작업자는 `inventory.stock.operate` 만 있고 CS 의 `order.claim.read` 는 없다.
 * 고객명은 가린 값(`customerMasked`)만 싣는다(N4) — 원문이 없어 `@PiiResponse` 대상이 아니다.
 */
@ApiTags('Admin - Customer Return Receiving')
@Controller('admin/customer-return-receiving')
export class CustomerReturnReceivingController {
  constructor(private readonly service: CustomerReturnService) {}

  @RequirePermission('inventory.stock.operate')
  @Get()
  @UseGuards(ScopeGuard)
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({
    summary: '창고 반품 도착 대기 목록 — 그 창고가 배송완료한 도착 전 반품과 그 창고에서 받기 시작한 반품',
  })
  list(@Query() query: ListReceivingCustomerReturnsQueryDto) {
    return this.service.listForReceiving(query);
  }

  @RequirePermission('inventory.stock.operate')
  @Get(':id')
  @UseGuards(ScopeGuard)
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '반품 기록 조회(창고) — 줄·SKU 항목별 기대·도착·검수 수량과 바코드' })
  @ApiParam({ name: 'id', description: '반품 기록 id(customer_returns.id)' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }
}
