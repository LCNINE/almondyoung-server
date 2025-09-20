import { Controller, Get, Post, Put, Body, Param, Query, UsePipes, Res } from '@nestjs/common';
import { Response } from 'express';
import { DirectShipService } from '../../shared/services/direct-ship.service';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';

const ForwardOrdersSchema = z.object({
  fulfillmentOrderIds: z.array(z.string().uuid()).min(1),
  companyName: z.string().min(1)
});

const CompleteOrdersSchema = z.object({
  fulfillmentOrderIds: z.array(z.string().uuid()).min(1),
  completedBy: z.string().min(1)
});

const ExportOrdersSchema = z.object({
  companyName: z.string().min(1),
  format: z.enum(['csv', 'xlsx']).default('csv')
});

@Controller('wms/direct-ship')
export class DirectShipController {
  constructor(
    private readonly directShipService: DirectShipService
  ) {}

  @Get('dashboard')
  async getDashboard() {
    return this.directShipService.getDashboard();
  }

  @Get('companies')
  async getCompanyList() {
    return this.directShipService.getCompanyList();
  }

  @Get('orders')
  async getDirectShipOrders(
    @Query('companyName') companyName?: string,
    @Query('status') status?: 'pending' | 'forwarded' | 'completed' | 'canceled',
    @Query('warehouseId') warehouseId?: string
  ) {
    return this.directShipService.getDirectShipOrders({
      companyName,
      status,
      warehouseId
    });
  }

  @Get('orders/by-company')
  async getDirectShipOrdersByCompany() {
    const ordersByCompany = await this.directShipService.getDirectShipOrdersByCompany();

    // Convert Map to Object for JSON serialization
    const result: Record<string, any> = {};
    for (const [companyName, orders] of ordersByCompany.entries()) {
      result[companyName] = orders;
    }

    return result;
  }

  @Post('orders/forward')
  @UsePipes(new ZodValidationPipe(ForwardOrdersSchema))
  async forwardOrders(@Body() dto: z.infer<typeof ForwardOrdersSchema>) {
    await this.directShipService.forwardOrdersToCompany(dto.fulfillmentOrderIds, dto.companyName);
    return {
      message: `Successfully forwarded ${dto.fulfillmentOrderIds.length} orders to ${dto.companyName}`
    };
  }

  @Put('orders/complete')
  @UsePipes(new ZodValidationPipe(CompleteOrdersSchema))
  async completeOrders(@Body() dto: z.infer<typeof CompleteOrdersSchema>) {
    await this.directShipService.markOrdersAsCompleted(dto.fulfillmentOrderIds, dto.completedBy);
    return {
      message: `Successfully completed ${dto.fulfillmentOrderIds.length} orders`
    };
  }

  @Get('export/:companyName')
  async exportOrdersData(@Param('companyName') companyName: string) {
    return this.directShipService.exportOrdersForCompany(companyName);
  }

  @Post('export/file')
  @UsePipes(new ZodValidationPipe(ExportOrdersSchema))
  async exportOrdersFile(
    @Body() dto: z.infer<typeof ExportOrdersSchema>,
    @Res() res: Response
  ) {
    const fileData = await this.directShipService.generateExportFile(dto.companyName, dto.format);

    res.setHeader('Content-Type', fileData.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileData.fileName}"`);
    res.send(fileData.content);
  }

  @Get('companies/:companyName/orders')
  async getCompanyOrders(
    @Param('companyName') companyName: string,
    @Query('status') status?: 'pending' | 'forwarded' | 'completed' | 'canceled'
  ) {
    return this.directShipService.getDirectShipOrders({
      companyName,
      status
    });
  }

  @Get('companies/:companyName/summary')
  async getCompanySummary(@Param('companyName') companyName: string) {
    const orders = await this.directShipService.getDirectShipOrders({ companyName });

    const summary = {
      companyName,
      totalOrders: orders.length,
      pendingOrders: orders.filter(o => o.status === 'pending').length,
      forwardedOrders: orders.filter(o => o.status === 'forwarded').length,
      completedOrders: orders.filter(o => o.status === 'completed').length,
      totalItems: orders.reduce((sum, order) => sum + order.totalItems, 0),
      lastOrderDate: orders.length > 0 ? orders[0].createdAt : null
    };

    return summary;
  }
}