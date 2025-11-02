import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProductAuditService } from '../services/product-audit.service';

@Controller('api/pim/audit')
export class ProductAuditController {
  constructor(private readonly auditService: ProductAuditService) {}

  @Get('products/:id')
  async getProductAuditHistory(@Param('id') productId: string) {
    return this.auditService.getProductAuditHistory(productId);
  }

  @Get('recent')
  async getRecentAuditLogs(@Query('limit') limit?: string) {
    return this.auditService.getRecentAuditLogs(
      limit ? parseInt(limit) : 100,
    );
  }

  @Get('by-user/:userId')
  async getAuditLogsByUser(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditService.getAuditLogsByUser(
      userId,
      limit ? parseInt(limit) : 100,
    );
  }

  @Get('by-action/:action')
  async getAuditLogsByAction(
    @Param('action') action: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditService.getAuditLogsByAction(
      action,
      limit ? parseInt(limit) : 100,
    );
  }
}

