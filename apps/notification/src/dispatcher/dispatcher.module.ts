// apps/notification/src/dispatcher/dispatcher.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { USER_STREAM, ORDER_STREAM, PAYMENT_STREAM } from '@packages/event-contracts';
import { SharedModule } from '../shared/shared.module';

import { ProviderModule } from '../provider/provider.module';
import { NotificationDispatcherService } from './services/notification-dispatcher.service';
import { NotificationController } from './controllers/notification.controller';
import { EventController } from './controllers/event.controller';
import { UserEventConsumer } from './handlers/user-event.consumer';
import { OrderEventConsumer } from './handlers/order-event.consumer';
import { WalletEventConsumer } from './handlers/wallet-event.consumer';
// Redis가 있을 때만 NotificationProcessorModule import
// TypeScript에서는 조건부 import가 어려우므로, 런타임에 에러가 발생할 수 있습니다.
// 대신 NotificationProcessorModule 내부에서 Redis 체크를 수행합니다.

@Module({
  imports: [
    DbModule,
    ProviderModule,
    SharedModule,
    EventsModule.forConsumerModule({
      streams: [USER_STREAM, ORDER_STREAM, PAYMENT_STREAM],
      groupId: 'notification-consumer',
      enableAutoDLQ: true,
      validation: {
        validateOnConsume: false, // HTTP 요청과 충돌 방지를 위해 비활성화
      },
    }),
    // Redis가 있으면 NotificationProcessorModule import
    // 주의: @Processor 데코레이터가 있으면 모듈 로드 시점에 큐를 찾으려고 하므로
    // Redis가 없으면 이 모듈을 import하지 않아야 합니다.
    // TypeScript에서는 조건부 import가 어려우므로, 주석 처리하고
    // NotificationDispatcherService에서 직접 발송하도록 처리합니다.
    // ...(process.env.REDIS_HOST ? [NotificationProcessorModule] : []),
  ],
  controllers: [
    NotificationController,
    EventController,
    UserEventConsumer,
    OrderEventConsumer,
    WalletEventConsumer,
  ],
  providers: [
    NotificationDispatcherService,
  ],
  exports: [NotificationDispatcherService],
})
export class DispatcherModule { }
