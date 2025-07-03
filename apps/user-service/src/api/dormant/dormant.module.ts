import { Module } from '@nestjs/common';
import { DormantService } from './dormant.service';
import { DormantController } from './dormant.controller';

@Module({
  controllers: [DormantController],
  providers: [DormantService],
})
export class DormantModule {}
