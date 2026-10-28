import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission, User } from '@app/authorization';
import { AdminPurchaseSatisfactionListResponseDto } from '../dto/admin-purchase-satisfaction-list-response.dto';
import { AdminPurchaseSatisfactionQueryDto } from '../dto/admin-purchase-satisfaction-query.dto';
import { PurchaseSatisfactionResponseDto } from '../dto/purchase-satisfaction-response.dto';
import { SetCheckedDto } from '../dto/set-checked.dto';
import { PurchaseSatisfactionService } from '../purchase-satisfaction.service';

@ApiTags('Purchase Satisfaction (admin)')
@ApiBearerAuth()
@Controller('purchase-satisfactions/admin')
export class AdminPurchaseSatisfactionController {
  constructor(private readonly service: PurchaseSatisfactionService) {}

  @RequirePermission('cs.satisfaction.read')
  @Get()
  @ApiOperation({ summary: '구매 만족도 목록과 요약 (수정 시각 최신순)' })
  @ApiResponse({ status: 200, type: AdminPurchaseSatisfactionListResponseDto })
  list(@Query() query: AdminPurchaseSatisfactionQueryDto): Promise<AdminPurchaseSatisfactionListResponseDto> {
    return this.service.listForAdmin(query);
  }

  @RequirePermission('cs.satisfaction.read')
  @Get('orders/:orderId')
  @ApiOperation({ summary: '주문별 구매 만족도 단건' })
  @ApiResponse({ status: 200, type: PurchaseSatisfactionResponseDto })
  getByOrder(@Param('orderId') orderId: string): Promise<PurchaseSatisfactionResponseDto> {
    return this.service.getByOrderId(orderId);
  }

  @RequirePermission('cs.satisfaction.manage')
  @Patch(':id/check')
  @ApiOperation({ summary: '구매 만족도 확인 처리 또는 해제' })
  @ApiResponse({ status: 200, type: PurchaseSatisfactionResponseDto })
  setChecked(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCheckedDto,
    @User('userId') adminId: string,
  ): Promise<PurchaseSatisfactionResponseDto> {
    return this.service.setChecked(id, dto.checked, adminId);
  }
}
