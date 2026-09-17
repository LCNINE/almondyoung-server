import { DynamicModule, Module } from '@nestjs/common';
import { isSafeDemoEnvironment, type DemoEnvironment } from '../../config/demo-stage.config';
import { ReplenishmentModule } from '../inventory/replenishment/replenishment.module';
import { DemoController } from './demo.controller';
import { DemoPracticeService } from './demo-practice.service';
import { InboundModule } from '../inventory/inbound/inbound.module';
import { CoreInventoryModule } from '../inventory/core/inventory.module';
import { DemoService } from './demo.service';
import { DemoCatalogService } from './demo-catalog.service';

@Module({})
export class DemoModule {
  static forEnvironment(env: DemoEnvironment = process.env): DynamicModule {
    if (!isSafeDemoEnvironment(env)) return { module: DemoModule };
    return {
      module: DemoModule,
      imports: [ReplenishmentModule, InboundModule, CoreInventoryModule],
      controllers: [DemoController],
      providers: [DemoService, DemoCatalogService, DemoPracticeService],
    };
  }
}
