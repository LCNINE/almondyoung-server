import { Controller, Get, Post, Put, Body, Param, Query, UsePipes, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { DirectShipService, DirectShipOrder } from '../services/direct-ship.service';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';

const ForwardOrdersSchema = z.object({
  fulfillmentOrderIds: z.array(z.string().uuid()).min(1),
  companyName: z.string().min(1),
});

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
  constructor(private readonly directShipService: DirectShipService) {}

  @Get('dashboard')
  @ApiOperation({ summary: '직송 대시보드' })
  async getDashboard() {
    return this.directShipService.getDashboard();
  }

  @Get('companies')
  @ApiOperation({ summary: '직송 회사 목록' })
  async getCompanyList() {
    return this.directShipService.getCompanyList();
  }

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

  @Get('orders/by-company')
  async getDirectShipOrdersByCompany() {
    const ordersByCompany = await this.directShipService.getDirectShipOrdersByCompany();
    const result: Record<string, DirectShipOrder[]> = {};
    for (const [companyName, orders] of ordersByCompany.entries()) {
      result[companyName] = orders;
    }
    return result;
  }

  @Post('orders/forward')
  @ApiOperation({ summary: '주문 전달' })
  @UsePipes(new ZodValidationPipe(ForwardOrdersSchema))
  async forwardOrders(@Body() dto: z.infer<typeof ForwardOrdersSchema>) {
    await this.directShipService.forwardOrdersToCompany(dto.fulfillmentOrderIds, dto.companyName);
    return { message: `Successfully forwarded ${dto.fulfillmentOrderIds.length} orders to ${dto.companyName}` };
  }

  @Put('orders/complete')
  @ApiOperation({ summary: '주문 완료 처리' })
  @UsePipes(new ZodValidationPipe(CompleteOrdersSchema))
  async completeOrders(@Body() dto: z.infer<typeof CompleteOrdersSchema>) {
    await this.directShipService.markOrdersAsCompleted(dto.fulfillmentOrderIds, dto.completedBy);
    return { message: `Successfully completed ${dto.fulfillmentOrderIds.length} orders` };
  }

  @Get('export/:companyName')
  @ApiOperation({ summary: '주문 데이터 내보내기' })
  @ApiParam({ name: 'companyName', description: '회사명' })
  async exportOrdersData(@Param('companyName') companyName: string) {
    return this.directShipService.exportOrdersForCompany(companyName);
  }

  @Post('export/file')
  @ApiOperation({ summary: '주문 파일 내보내기' })
  @UsePipes(new ZodValidationPipe(ExportOrdersSchema))
  async exportOrdersFile(@Body() dto: z.infer<typeof ExportOrdersSchema>, @Res() res: Response) {
    const fileData = await this.directShipService.generateExportFile(dto.companyName, dto.format);
    res.setHeader('Content-Type', fileData.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileData.fileName}"`);
    res.send(fileData.content);
  }

  @Get('companies/:companyName/orders')
  async getCompanyOrders(
    @Param('companyName') companyName: string,
    @Query('status') status?: 'pending' | 'forwarded' | 'completed' | 'canceled',
  ) {
    return this.directShipService.getDirectShipOrders({ companyName, status });
  }

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
}
