import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard, User } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../platform/auth/inventory-scopes';
import { DemoPracticeService, parsePracticeRequest } from './demo-practice.service';
import { DemoService } from './demo.service';
import { DemoCatalogService, parseDemoCatalogQuery } from './demo-catalog.service';

@ApiTags('Demo')
@Controller('demo')
@UseGuards(ScopeGuard)
@RequireScopes(INVENTORY_SCOPE.MANAGE)
export class DemoController {
  constructor(
    private readonly service: DemoService,
    private readonly products: DemoCatalogService,
    private readonly practice: DemoPracticeService,
  ) {}

  @Get('catalog')
  @ApiOperation({ summary: 'Search demo products and current component availability' })
  catalog(@Query() query: Record<string, unknown> = {}) {
    return this.products.catalog(parseDemoCatalogQuery(query));
  }

  @Get('readiness')
  @ApiOperation({ summary: 'Demo logistics fixture readiness' })
  async readiness() {
    const [readiness, coverage] = await Promise.all([this.service.readiness(), this.products.coverage()]);
    return { ...readiness, coverage };
  }

  @Get('shipments')
  @ApiOperation({ summary: 'Most recent persisted demo carrier shipments' })
  shipments() {
    return this.service.shipments();
  }

  @Post('practice')
  @HttpCode(200)
  preparePractice(@Body() body: unknown, @User('userId') actorId: string) {
    return this.practice.prepare(parsePracticeRequest(body), actorId);
  }

  @Post('recompute')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run the existing full replenishment recomputation' })
  recompute() {
    return this.service.recompute();
  }
}
