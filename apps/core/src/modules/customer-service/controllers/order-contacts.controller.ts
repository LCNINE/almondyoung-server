import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PiiResponse, RequireAnyPermission, RequirePermission, User } from '@app/authorization';
import { CreateOrderContactDto, OrderContactCreatedDto, OrderContactListDto } from '../dto/order-contact.dto';
import { OrderContactsService } from '../services/order-contacts.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string } | undefined;

@ApiTags('Order Contacts')
@ApiBearerAuth()
@Controller('order-contacts')
export class OrderContactsController {
  constructor(private readonly service: OrderContactsService) {}

  @RequirePermission('cs.inquiry.write')
  @Post()
  @ApiOperation({ summary: '주문 고객에게 연락한 기록 남기기' })
  @ApiResponse({ status: 201, type: OrderContactCreatedDto })
  create(@Body() dto: CreateOrderContactDto, @User() user: AuthenticatedUser) {
    const authorId = user?.id ?? user?.userId ?? user?.sub;
    if (!authorId) throw new UnauthorizedException();
    return this.service.create(dto, authorId);
  }

  @PiiResponse({
    fields: { 'items[].body': 'text' },
    subjects: [{ param: 'salesOrderId', type: 'sales_order' }],
    reveal: true,
  })
  @RequireAnyPermission('cs.inquiry.read', 'fulfillment.order.read')
  @Get('orders/:salesOrderId')
  @ApiOperation({ summary: '주문의 연락 기록(최근 것부터)' })
  @ApiResponse({ status: 200, type: OrderContactListDto })
  list(@Param('salesOrderId', ParseUUIDPipe) salesOrderId: string) {
    return this.service.list(salesOrderId);
  }
}
