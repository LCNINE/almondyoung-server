import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../platform/auth/inventory-scopes';
import { DemoService } from './demo.service';

@ApiTags('Demo')
@Controller('demo')
@UseGuards(ScopeGuard)
@RequireScopes(INVENTORY_SCOPE.MANAGE)
export class DemoController {
  constructor(private readonly service: DemoService) {}

  @Get('catalog')
  @ApiOperation({ summary: 'Deterministic demo catalog and current stock' })
  catalog() {
    return this.service.catalog();
  }

  @Get('readiness')
  @ApiOperation({ summary: 'Demo logistics fixture readiness' })
  readiness() {
    return this.service.readiness();
  }

  @Get('shipments')
  @ApiOperation({ summary: 'Most recent persisted demo carrier shipments' })
  shipments() {
    return this.service.shipments();
  }

  @Post('recompute')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run the existing full replenishment recomputation' })
  recompute() {
    return this.service.recompute();
  }
}
