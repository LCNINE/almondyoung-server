// apps/notification/src/dispatcher/dispatcher.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { USER_STREAM, ORDER_STREAM, WALLET_STREAM } from '@packages/event-contracts';
import { SharedModule } from '../shared/shared.module';

import { ProviderModule } from '../provider/provider.module';
import { NotificationDispatcherService } from './services/notification-dispatcher.service';
import { NotificationController } from './controllers/notification.controller';
import { EventController } from './controllers/event.controller';
import { NotificationProcessor } from './processors/notification.processor';
import { UserEventConsumer } from './handlers/user-event.consumer';
import { OrderEventConsumer } from './handlers/order-event.consumer';
import { WalletEventConsumer } from './handlers/wallet-event.consumer';

@Module({
  imports: [
    DbModule,
    ProviderModule,
    SharedModule,
    EventsModule.forConsumerModule({
      streams: [USER_STREAM, ORDER_STREAM, WALLET_STREAM],
      groupId: 'notification-consumer',
      enableAutoDLQ: true,
      validation: {
        validateOnConsume: false, // HTTP 요청과 충돌 방지를 위해 비활성화
      },
    }),
    BullModule.registerQueue({
      name: 'notification',
    }),
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
    NotificationProcessor,
  ],
  exports: [NotificationDispatcherService],
})
export class DispatcherModule {}
