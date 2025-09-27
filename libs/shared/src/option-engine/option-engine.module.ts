import { Module } from '@nestjs/common';
import { OptionEngineService } from './option-engine.service';

@Module({
  providers: [OptionEngineService],
  exports: [OptionEngineService],
})
export class OptionEngineModule {}


