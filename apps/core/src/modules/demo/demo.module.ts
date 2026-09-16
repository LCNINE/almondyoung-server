import { DynamicModule, Module } from '@nestjs/common';
import { isSafeDemoEnvironment, type DemoEnvironment } from '../../config/demo-stage.config';
import { ReplenishmentModule } from '../inventory/replenishment/replenishment.module';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';

@Module({})
export class DemoModule {
  static forEnvironment(env: DemoEnvironment = process.env): DynamicModule {
    if (!isSafeDemoEnvironment(env)) return { module: DemoModule };
    return {
      module: DemoModule,
      imports: [ReplenishmentModule],
      controllers: [DemoController],
      providers: [DemoService],
    };
  }
}
