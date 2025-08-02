import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import * as schema from '../shared/schemas/entities/schema';

/**
 * 구독 관리 모듈
 */
@Module({
  imports: [DbModule, EventsModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
