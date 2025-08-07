import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { Module } from '@nestjs/common';
import { DormantController } from './dormant.controller';
import { DormantService } from './dormant.service';

@Module({
  imports: [DbModule, EventsModule],
  controllers: [DormantController],
  providers: [DormantService],
})
export class DormantModule {}
