import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { User, RequirePermission } from '@app/authorization';
import { DemoPracticeService, parsePracticeRequest } from './demo-practice.service';
import { DemoReplenishmentService } from './demo-replenishment.service';
import { parseDemoReplenishmentRequest } from './demo-replenishment.input';
import { DemoService } from './demo.service';
import { DemoCatalogService, parseDemoCatalogQuery } from './demo-catalog.service';

@ApiTags('Demo')
@Controller('demo')
export class DemoController {
  constructor(
    private readonly service: DemoService,
    private readonly products: DemoCatalogService,
    private readonly practice: DemoPracticeService,
    private readonly replenishment: DemoReplenishmentService,
  ) {}

  @RequirePermission('inventory.master.read')
  @Get('catalog')
  @ApiOperation({ summary: 'Search demo products and current component availability' })
  catalog(@Query() query: Record<string, unknown> = {}) {
    return this.products.catalog(parseDemoCatalogQuery(query));
  }

  @RequirePermission('inventory.master.read')
  @Get('readiness')
  @ApiOperation({ summary: 'Demo logistics fixture readiness' })
  async readiness() {
    const [readiness, coverage] = await Promise.all([this.service.readiness(), this.products.coverage()]);
    return { ...readiness, coverage };
  }

  @RequirePermission('inventory.master.read')
  @Get('shipments')
  @ApiOperation({ summary: 'Most recent persisted demo carrier shipments' })
  shipments() {
    return this.service.shipments();
  }

  @RequirePermission('inventory.master.write')
  @Post('practice')
  @HttpCode(200)
  preparePractice(@Body() body: unknown, @User('userId') actorId: string) {
    return this.practice.prepare(parsePracticeRequest(body), actorId);
  }

  @RequirePermission('inventory.master.write')
  @Post('replenishment')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Prepare synthetic demand for random or selected unused real SKUs and verify purchase suggestions',
  })
  prepareReplenishment(@Body() body: unknown, @User('userId') actorId: string) {
    return this.replenishment.prepare(parseDemoReplenishmentRequest(body), actorId);
  }

  @RequirePermission('inventory.master.write')
  @Post('recompute')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run the existing full replenishment recomputation' })
  recompute() {
    return this.service.recompute();
  }
}
