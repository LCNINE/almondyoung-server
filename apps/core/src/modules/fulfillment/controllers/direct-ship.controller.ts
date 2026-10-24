import { Controller, Get, Post, Put, Body, Param, Query, UsePipes, Res, BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { DirectShipService, DirectShipOrder } from '../services/direct-ship.service';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';
import { DirectShipCancelNoticeService } from '../direct-ship-cancel-notice/direct-ship-cancel-notice.service';
import { RequirePermission, User, PiiResponse, OPEN_WITH_RECIPIENT } from '@app/authorization';

const ForwardOrdersSchema = z.object({
  fulfillmentOrderIds: z.array(z.string().uuid()).min(1),
  companyName: z.string().min(1),
});

const CancelNoticeExportSchema = z.object({
  companyName: z.string().min(1),
});

const CancelNoticeNotifiedSchema = z.object({
  companyName: z.string().min(1),
  noticeIds: z.array(z.string().uuid()).min(1).max(500),
});

type AuthenticatedUser = { id?: string; userId?: string };

const CompleteOrdersSchema = z.object({
  fulfillmentOrderIds: z.array(z.string().uuid()).min(1),
  completedBy: z.string().min(1),
});

const ExportOrdersSchema = z.object({
  companyName: z.string().min(1),
  format: z.enum(['csv', 'xlsx']).default('csv'),
});

@ApiTags('Direct Ship')
@Controller('direct-ship')
export class DirectShipController {
  constructor(
    private readonly directShipService: DirectShipService,
    private readonly cancelNotices: DirectShipCancelNoticeService,
  ) {}

  @RequirePermission('fulfillment.order.read')
  @Get('dashboard')
  @ApiOperation({ summary: '직송 대시보드' })
  async getDashboard() {
    return this.directShipService.getDashboard();
  }

  @RequirePermission('fulfillment.order.read')
  @Get('companies')
  @ApiOperation({ summary: '직송 회사 목록' })
  async getCompanyList() {
    return this.directShipService.getCompanyList();
  }

  @PiiResponse({
    fields: {
      '[].customerInfo.customerName': 'name',
      '[].customerInfo.customerEmail': 'email',
      '[].customerInfo.customerPhone': 'phone',
      '[].customerInfo.shippingAddress.recipientName': 'name',
      '[].customerInfo.shippingAddress.phone': 'phone',
      '[].customerInfo.shippingAddress.postalCode': 'postal',
      '[].customerInfo.shippingAddress.roadAddress': 'address',
      '[].customerInfo.shippingAddress.detailAddress': 'text',
      '[].customerInfo.shippingAddress.deliveryNote': 'text',
      '[].customerInfo.shippingAddress.personalCustomsCode': 'secret',
    },
    subjects: [
      { path: '[].salesOrderId', type: 'sales_order' },
    ],
    rawWithByField: {
      '[].customerInfo.customerName': OPEN_WITH_RECIPIENT,
      '[].customerInfo.customerPhone': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.recipientName': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.phone': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.postalCode': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.roadAddress': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.detailAddress': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.deliveryNote': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.personalCustomsCode': OPEN_WITH_RECIPIENT,
    },
  })
  @RequirePermission('fulfillment.order.read')
  @Get('orders')
  @ApiOperation({ summary: '직송 주문 목록' })
  @ApiQuery({ name: 'companyName', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'forwarded', 'completed', 'canceled'] })
  @ApiQuery({ name: 'warehouseId', required: false })
  async getDirectShipOrders(
    @Query('companyName') companyName?: string,
    @Query('status') status?: 'pending' | 'forwarded' | 'completed' | 'canceled',
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.directShipService.getDirectShipOrders({ companyName, status, warehouseId });
  }

  @PiiResponse({
    fields: {
      '*[].customerInfo.customerName': 'name',
      '*[].customerInfo.customerEmail': 'email',
      '*[].customerInfo.customerPhone': 'phone',
      '*[].customerInfo.shippingAddress.recipientName': 'name',
      '*[].customerInfo.shippingAddress.phone': 'phone',
      '*[].customerInfo.shippingAddress.postalCode': 'postal',
      '*[].customerInfo.shippingAddress.roadAddress': 'address',
      '*[].customerInfo.shippingAddress.detailAddress': 'text',
      '*[].customerInfo.shippingAddress.deliveryNote': 'text',
      '*[].customerInfo.shippingAddress.personalCustomsCode': 'secret',
    },
    subjects: [
      { path: '*[].salesOrderId', type: 'sales_order' },
    ],
    rawWithByField: {
      '*[].customerInfo.customerName': OPEN_WITH_RECIPIENT,
      '*[].customerInfo.customerPhone': OPEN_WITH_RECIPIENT,
      '*[].customerInfo.shippingAddress.recipientName': OPEN_WITH_RECIPIENT,
      '*[].customerInfo.shippingAddress.phone': OPEN_WITH_RECIPIENT,
      '*[].customerInfo.shippingAddress.postalCode': OPEN_WITH_RECIPIENT,
      '*[].customerInfo.shippingAddress.roadAddress': OPEN_WITH_RECIPIENT,
      '*[].customerInfo.shippingAddress.detailAddress': OPEN_WITH_RECIPIENT,
      '*[].customerInfo.shippingAddress.deliveryNote': OPEN_WITH_RECIPIENT,
      '*[].customerInfo.shippingAddress.personalCustomsCode': OPEN_WITH_RECIPIENT,
    },
  })
  @RequirePermission('fulfillment.order.read')
  @Get('orders/by-company')
  async getDirectShipOrdersByCompany() {
    const ordersByCompany = await this.directShipService.getDirectShipOrdersByCompany();
    const result: Record<string, DirectShipOrder[]> = {};
    for (const [companyName, orders] of ordersByCompany.entries()) {
      result[companyName] = orders;
    }
    return result;
  }

  @RequirePermission('fulfillment.order.write')
  @Post('orders/forward')
  @ApiOperation({ summary: '주문 전달' })
  @UsePipes(new ZodValidationPipe(ForwardOrdersSchema))
  async forwardOrders(@Body() dto: z.infer<typeof ForwardOrdersSchema>) {
    await this.directShipService.forwardOrdersToCompany(dto.fulfillmentOrderIds, dto.companyName);
    return { message: `Successfully forwarded ${dto.fulfillmentOrderIds.length} orders to ${dto.companyName}` };
  }

  @RequirePermission('fulfillment.order.write')
  @Put('orders/complete')
  @ApiOperation({ summary: '주문 완료 처리' })
  @UsePipes(new ZodValidationPipe(CompleteOrdersSchema))
  async completeOrders(@Body() dto: z.infer<typeof CompleteOrdersSchema>) {
    await this.directShipService.markOrdersAsCompleted(dto.fulfillmentOrderIds, dto.completedBy);
    return { message: `Successfully completed ${dto.fulfillmentOrderIds.length} orders` };
  }

  @PiiResponse({
    fields: {
      'orders[].customerInfo.customerName': 'name',
      'orders[].customerInfo.customerEmail': 'email',
      'orders[].customerInfo.customerPhone': 'phone',
      'orders[].customerInfo.shippingAddress.recipientName': 'name',
      'orders[].customerInfo.shippingAddress.phone': 'phone',
      'orders[].customerInfo.shippingAddress.postalCode': 'postal',
      'orders[].customerInfo.shippingAddress.roadAddress': 'address',
      'orders[].customerInfo.shippingAddress.detailAddress': 'text',
      'orders[].customerInfo.shippingAddress.deliveryNote': 'text',
      'orders[].customerInfo.shippingAddress.personalCustomsCode': 'secret',
    },
    subjects: [
      { path: 'orders[].salesOrderId', type: 'sales_order' },
    ],
  })
  @RequirePermission('order.order.export')
  @Get('export/:companyName')
  @ApiOperation({ summary: '주문 데이터 내보내기' })
  @ApiParam({ name: 'companyName', description: '회사명' })
  async exportOrdersData(@Param('companyName') companyName: string) {
    return this.directShipService.exportOrdersForCompany(companyName);
  }

  @RequirePermission('order.order.export')
  @Post('export/file')
  @ApiOperation({ summary: '주문 파일 내보내기' })
  @UsePipes(new ZodValidationPipe(ExportOrdersSchema))
  async exportOrdersFile(@Body() dto: z.infer<typeof ExportOrdersSchema>, @Res() res: Response) {
    const fileData = await this.directShipService.generateExportFile(dto.companyName, dto.format);
    res.setHeader('Content-Type', fileData.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileData.fileName}"`);
    res.send(fileData.content);
  }

  @PiiResponse({
    fields: {
      '[].customerInfo.customerName': 'name',
      '[].customerInfo.customerEmail': 'email',
      '[].customerInfo.customerPhone': 'phone',
      '[].customerInfo.shippingAddress.recipientName': 'name',
      '[].customerInfo.shippingAddress.phone': 'phone',
      '[].customerInfo.shippingAddress.postalCode': 'postal',
      '[].customerInfo.shippingAddress.roadAddress': 'address',
      '[].customerInfo.shippingAddress.detailAddress': 'text',
      '[].customerInfo.shippingAddress.deliveryNote': 'text',
      '[].customerInfo.shippingAddress.personalCustomsCode': 'secret',
    },
    subjects: [
      { path: '[].salesOrderId', type: 'sales_order' },
    ],
    rawWithByField: {
      '[].customerInfo.customerName': OPEN_WITH_RECIPIENT,
      '[].customerInfo.customerPhone': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.recipientName': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.phone': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.postalCode': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.roadAddress': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.detailAddress': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.deliveryNote': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.personalCustomsCode': OPEN_WITH_RECIPIENT,
    },
  })
  @RequirePermission('fulfillment.order.read')
  @Get('companies/:companyName/orders')
  async getCompanyOrders(
    @Param('companyName') companyName: string,
    @Query('status') status?: 'pending' | 'forwarded' | 'completed' | 'canceled',
  ) {
    return this.directShipService.getDirectShipOrders({ companyName, status });
  }

  @RequirePermission('fulfillment.order.read')
  @Get('companies/:companyName/summary')
  async getCompanySummary(@Param('companyName') companyName: string) {
    const orders = await this.directShipService.getDirectShipOrders({ companyName });
    return {
      companyName,
      totalOrders: orders.length,
      pendingOrders: orders.filter((o) => o.status === 'pending').length,
      forwardedOrders: orders.filter((o) => o.status === 'forwarded').length,
      completedOrders: orders.filter((o) => o.status === 'completed').length,
      totalItems: orders.reduce((sum, order) => sum + order.totalItems, 0),
      lastOrderDate: orders.length > 0 ? orders[0].createdAt : null,
    };
  }

  @RequirePermission('fulfillment.order.read')
  @Get('cancel-notices')
  @ApiOperation({ summary: '업체에 알릴 취소 대기함' })
  @ApiQuery({ name: 'companyName', required: false })
  async getCancelNotices(@Query('companyName') companyName?: string) {
    return this.cancelNotices.listOpen({ companyName });
  }

  @RequirePermission('order.order.export')
  @Post('cancel-notices/export/file')
  @ApiOperation({ summary: '알릴 취소 CSV 내려받기' })
  @UsePipes(new ZodValidationPipe(CancelNoticeExportSchema))
  async exportCancelNoticesFile(@Body() dto: z.infer<typeof CancelNoticeExportSchema>, @Res() res: Response) {
    const fileData = await this.cancelNotices.exportFile(dto.companyName);
    res.setHeader('Content-Type', fileData.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileData.fileName)}`);
    res.send(fileData.content);
  }

  @RequirePermission('fulfillment.order.write')
  @Post('cancel-notices/notified')
  @ApiOperation({ summary: '알릴 취소 알림 완료' })
  // 파이프는 본문에만 건다 — 메서드 단위 @UsePipes 는 @User() 까지 지나가 사용자 객체를 본문 스키마로 파싱한다
  async markCancelNoticesNotified(
    @Body(new ZodValidationPipe(CancelNoticeNotifiedSchema)) dto: z.infer<typeof CancelNoticeNotifiedSchema>,
    @User() user: AuthenticatedUser,
  ) {
    const actor = user?.id ?? user?.userId;
    if (!actor) throw new BadRequestException('Authenticated actor is required');
    return this.cancelNotices.markNotified(dto.companyName, dto.noticeIds, actor);
  }
}
